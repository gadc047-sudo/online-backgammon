/**
 * Decides WHEN Jev acts, and applies what it decided through the ordinary
 * `RoomRegistry` methods — the same ones a human socket handler calls.
 *
 * This is the heuristic driver's shape (CLAUDE.md principle 8) with three
 * differences that follow from Jev being a network call rather than a pure
 * function:
 *
 *  - **No artificial delay.** The demo runs as fast as the API and engine
 *    allow; the only pause is the real call, which the panel shows as
 *    "thinking" and clears the moment the answer lands.
 *  - **One decision in flight per room.** A poke while a call is outstanding is
 *    dropped, not queued. Without this, two broadcasts arriving during one
 *    request would spend two API calls and try to apply two actions.
 *  - **A turn is decided once.** `legalSequences` enumerates a whole turn, so
 *    the model is asked once per roll and the chosen sequence is cached and
 *    played hop by hop. Re-asking per hop would cost four calls on a double
 *    and could contradict the play already half-made.
 *
 * It also stops entirely when nobody is watching. Both seats at a Jev table are
 * driven, so without this check an abandoned tab would leave two bots playing
 * each other against a paid API until the room is reaped.
 */

import {
  canDouble,
  canEndTurn,
  legalMovesNow,
  type BoardState,
  type GameState,
  type Move,
  type Player,
} from '../../../engine';
import type { JevDecision } from '../../../shared/protocol';
import type { TypeSafeClient } from '../../typesafe/client';
import type { Room, RoomRegistry } from '../../rooms';
import { decideCubeOffer, decideCubeResponse, decideMove } from './policy';

export interface JevDriver {
  /**
   * Check whether Jev has something to do at `code` and, if so, do it, then
   * check again. A no-op when the room has no Jev seat, nobody is watching, or
   * a decision is already in flight.
   */
  poke(code: string): void;
}

export interface JevDriverOptions {
  /**
   * Normally zero: locked behaviour 8 is "as fast as possible". Exposed so a
   * future demo could be slowed deliberately, and so tests can prove the value
   * is actually threaded through.
   */
  readonly delayMs?: number;
  readonly scheduler?: (run: () => void, delayMs: number) => void;
}

const immediateScheduler = (run: () => void, delayMs: number): void => {
  if (delayMs <= 0) {
    queueMicrotask(run);
    return;
  }
  setTimeout(run, delayMs);
};

/** Cached whole-turn play, so one roll costs one call however many hops it has. */
interface CachedTurn {
  readonly key: string;
  readonly sequence: readonly Move[];
}

function turnKey(board: BoardState, game: GameState): string {
  const points = board.points
    .map((p) => (p.color === null || p.count === 0 ? '.' : `${p.color === 'white' ? 'w' : 'b'}${p.count}`))
    .join('|');
  return `${points}#${board.bar.white},${board.bar.black}#${board.off.white},${board.off.black}#${game.dice.join(',')}`;
}

/** Sync steps need no model call; async ones do. Split so the panel only shows
 *  "thinking" when a request is genuinely outstanding. */
type JevStep =
  | { readonly kind: 'openingRoll' }
  | { readonly kind: 'roll' }
  | { readonly kind: 'endTurn' }
  | { readonly kind: 'playCached'; readonly move: Move }
  | { readonly kind: 'decideMove' }
  | { readonly kind: 'decideCubeOffer' }
  | { readonly kind: 'decideCubeResponse' };

function planStep(room: Room, jev: Player, cached: CachedTurn | undefined): JevStep | null {
  const game = room.game;
  if (!game) return null;

  // Game over is terminal for the demo. Both seats here are driven, so an
  // automatic rematch would mean two bots playing an unbounded series against a
  // metered API for as long as a tab stays open. The watcher restarts it.
  if (room.status === 'game-over') return null;

  switch (game.phase) {
    case 'opening-roll':
      if (game.openingRolls[jev] !== undefined) return null;
      // Unlike the heuristic seat, Jev rolls without waiting: there is no human
      // at this table whose roll could race it over the wire.
      return { kind: 'openingRoll' };

    case 'awaiting-roll':
      if (game.turn !== jev) return null;
      // The roll itself is not a judgement; the cube decision before it is.
      // `jevCubeAsked` is what stops a declined double being re-asked on the
      // next poke — the registry clears it on every roll, so the question comes
      // back once per turn and not once per broadcast.
      if (canDouble(game, jev) && !room.jevCubeAsked) return { kind: 'decideCubeOffer' };
      return { kind: 'roll' };

    case 'moving': {
      if (game.turn !== jev) return null;
      if (canEndTurn(game)) return { kind: 'endTurn' };
      if (legalMovesNow(game).length === 0) return null;

      const board = game.turnStartBoard;
      if (!board) return null;

      if (cached && cached.key === turnKey(board, game)) {
        const move = cached.sequence[game.movesPlayed.length];
        return move ? { kind: 'playCached', move } : { kind: 'endTurn' };
      }
      return { kind: 'decideMove' };
    }

    case 'cube-offered':
      if (game.turn !== jev) return null;
      return { kind: 'decideCubeResponse' };

    case 'game-over':
    default:
      return null;
  }
}

export function createJevDriver(
  registry: RoomRegistry,
  client: TypeSafeClient,
  onChange: (room: Room) => void,
  options: JevDriverOptions = {},
): JevDriver {
  const delayMs = options.delayMs ?? 0;
  const scheduler = options.scheduler ?? immediateScheduler;

  /** Rooms with a decision outstanding. The whole concurrency story. */
  const inFlight = new Set<string>();
  const turns = new Map<string, CachedTurn>();

  function poke(code: string): void {
    if (inFlight.has(code)) return;

    const room = registry.getRoom(code);
    if (!room) {
      turns.delete(code);
      return;
    }
    const seat = room.seats.find((s) => s.isJev);
    if (!seat) return;
    // Nobody watching: stop. A reconnecting spectator's snapshot pokes again.
    if (!registry.hasConnectedSpectator(room)) return;

    const step = planStep(room, seat.player, turns.get(code));
    if (!step) return;

    inFlight.add(code);
    scheduler(() => {
      void run(code, seat.playerId, seat.player, step).finally(() => {
        inFlight.delete(code);
        poke(code);
      });
    }, delayMs);
  }

  async function run(
    code: string,
    jevId: string,
    jev: Player,
    step: JevStep,
  ): Promise<void> {
    // Re-read: a whole turn of the opponent's can land between planning and
    // running, and the registry is the only authority on what is true now.
    const room = registry.getRoom(code);
    if (!room) return;

    try {
      switch (step.kind) {
        case 'openingRoll':
          onChange(registry.openingRoll(jevId));
          return;
        case 'roll':
          turns.delete(code);
          onChange(registry.roll(jevId));
          return;
        case 'endTurn':
          turns.delete(code);
          onChange(registry.endTurn(jevId));
          return;
        case 'playCached':
          onChange(registry.move(jevId, step.move));
          return;
        case 'decideMove':
          await runMove(room, code, jevId, jev);
          return;
        case 'decideCubeOffer':
          await runCubeOffer(room, code, jevId, jev);
          return;
        case 'decideCubeResponse':
          await runCubeResponse(room, code, jevId, jev);
          return;
        default: {
          const unreachable: never = step;
          throw new Error(`Unhandled Jev step ${JSON.stringify(unreachable)}`);
        }
      }
    } catch (error) {
      // A registry rejection here means the plan went stale — the opponent's
      // driver moved first, or the spectator tore the room down mid-call. The
      // next poke re-plans from live state, so drop it rather than retrying.
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[jev] ${step.kind} failed at ${code}:`, error);
      }
      const after = registry.getRoom(code);
      if (after) onChange(after);
    }
  }

  /** Marks the panel as thinking and pushes it, so the UI shows the wait. */
  function announceThinking(code: string): void {
    const room = registry.setJevThinking(code, true);
    if (room) onChange(room);
  }

  function record(code: string, decision: Omit<JevDecision, 'id'>, error: string | null): void {
    registry.recordJevDecision(code, decision, error);
  }

  async function runMove(room: Room, code: string, jevId: string, jev: Player): Promise<void> {
    const game = room.game;
    if (!game || !game.turnStartBoard) return;
    const key = turnKey(game.turnStartBoard, game);

    announceThinking(code);
    const outcome = await decideMove(client, game, jev, room.stake);

    // The room can vanish or move on while the call is out. Only commit if the
    // turn we decided for is still the turn that is waiting.
    const live = registry.getRoom(code);
    const liveGame = live?.game;
    if (!live || !liveGame || !liveGame.turnStartBoard || turnKey(liveGame.turnStartBoard, liveGame) !== key) {
      const stale = registry.setJevThinking(code, false);
      if (stale) onChange(stale);
      return;
    }

    turns.set(code, { key, sequence: outcome.sequence });
    record(code, outcome.decision, outcome.error);

    const move = outcome.sequence[liveGame.movesPlayed.length];
    onChange(move ? registry.move(jevId, move) : registry.endTurn(jevId));
  }

  async function runCubeOffer(room: Room, code: string, jevId: string, jev: Player): Promise<void> {
    const game = room.game;
    if (!game) return;

    announceThinking(code);
    const outcome = await decideCubeOffer(client, game, jev, room.stake);

    const live = registry.getRoom(code);
    if (!live || !live.game || live.game.phase !== 'awaiting-roll' || live.game.turn !== jev) {
      const stale = registry.setJevThinking(code, false);
      if (stale) onChange(stale);
      return;
    }

    record(code, outcome.decision, outcome.error);
    // Asked once per turn either way, so declining to double does not re-ask
    // on the next poke. Cleared by the registry when the turn changes.
    registry.markJevCubeAsked(code, true);
    onChange(outcome.act ? registry.offerDouble(jevId) : live);
  }

  async function runCubeResponse(
    room: Room,
    code: string,
    jevId: string,
    jev: Player,
  ): Promise<void> {
    const game = room.game;
    if (!game) return;

    announceThinking(code);
    const outcome = await decideCubeResponse(client, game, jev, room.stake);

    const live = registry.getRoom(code);
    if (!live || !live.game || live.game.phase !== 'cube-offered' || live.game.turn !== jev) {
      const stale = registry.setJevThinking(code, false);
      if (stale) onChange(stale);
      return;
    }

    record(code, outcome.decision, outcome.error);
    onChange(registry.respondToDouble(jevId, outcome.act));
  }

  return { poke };
}
