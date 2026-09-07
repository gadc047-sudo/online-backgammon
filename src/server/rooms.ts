import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  canDouble,
  canEndTurn,
  createGame,
  endTurn,
  legalMovesNow,
  offerDouble,
  opponentOf,
  pointsWon,
  resign,
  respondToDouble,
  undoLastMove,
} from '../engine';
import type { DieValue, GameState, Move, Player } from '../engine/types';
import {
  DEFAULT_STAKE,
  MAX_STAKE,
  MIN_STAKE,
  ROOM_IDLE_TTL_MS,
  STARTING_CHIPS,
} from '../shared/protocol';
import type { GameResult, LogEntry, RoomSnapshot, RoomStatus, Seat } from '../shared/protocol';
import { generateCode, normaliseCode } from './codes';
import { cryptoDice } from './dice';
import type { DiceSource } from './dice';

/**
 * An error whose message is safe to show a player verbatim. Anything else that
 * escapes a handler is logged server-side and reported as a generic failure, so
 * we never leak internals through an ack.
 */
export class RoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomError';
  }
}

interface MutableSeat {
  playerId: string;
  name: string;
  player: Player;
  chips: number;
  connected: boolean;
}

export interface Room {
  code: string;
  stake: number;
  seats: MutableSeat[];
  game: GameState | null;
  status: RoomStatus;
  log: LogEntry[];
  lastResult: GameResult | null;
  rematchRequests: Set<Player>;
  createdAt: number;
  lastActivityAt: number;
  nextLogId: number;
}

const MAX_LOG_ENTRIES = 60;
const MAX_NAME_LENGTH = 18;

function sanitiseName(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Player';
}

function sanitiseStake(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_STAKE;
  const rounded = Math.round(raw);
  if (rounded < MIN_STAKE) return MIN_STAKE;
  if (rounded > MAX_STAKE) return MAX_STAKE;
  return rounded;
}

function describeDie(die: DieValue): string {
  return String(die);
}

/**
 * In-memory room registry.
 *
 * CLAUDE.md principle 5: this is deliberately the whole persistence story for
 * v1. A Railway redeploy restarts the process and drops every live game, and it
 * cannot scale past a single instance. That is an accepted trade-off to be
 * revisited (Redis or Postgres) when there are real users — not before.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  private readonly playerRooms = new Map<string, string>();

  /**
   * Chip balances by playerId, so a balance follows a player between tables
   * instead of resetting to the starting stack every time they sit down.
   * In memory like everything else here: a restart wipes it, which the README
   * states plainly. These are play-money counters, not an account balance.
   */
  private readonly bank = new Map<string, number>();

  constructor(private readonly dice: DiceSource = cryptoDice) {}

  /** Current balance for a player, seeded at the starting stack. */
  chipsFor(playerId: string): number {
    return this.bank.get(playerId) ?? STARTING_CHIPS;
  }

  get size(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  findRoomForPlayer(playerId: string): Room | undefined {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  // ---------------------------------------------------------------- lifecycle

  createRoom(playerId: string, name: string, stake: number): Room {
    if (!playerId) throw new RoomError('Missing player id.');
    this.detach(playerId);

    let code = generateCode();
    // Codes are short enough that collisions are possible, so probe.
    for (let attempts = 0; this.rooms.has(code) && attempts < 50; attempts += 1) {
      code = generateCode();
    }
    if (this.rooms.has(code)) throw new RoomError('Could not allocate a table code. Try again.');

    const now = Date.now();
    const room: Room = {
      code,
      stake: sanitiseStake(stake),
      seats: [
        {
          playerId,
          name: sanitiseName(name),
          player: 'white',
          chips: this.chipsFor(playerId),
          connected: true,
        },
      ],
      game: null,
      status: 'waiting',
      log: [],
      lastResult: null,
      rematchRequests: new Set(),
      createdAt: now,
      lastActivityAt: now,
      nextLogId: 1,
    };

    this.rooms.set(code, room);
    this.playerRooms.set(playerId, code);
    this.addLog(room, `${room.seats[0]?.name ?? 'Player'} opened the table. Stake ${room.stake} chips per point.`);
    return room;
  }

  /**
   * Joins a table, or reclaims an existing seat. Reclaiming is the reconnect
   * path (principle 4): a returning `playerId` always gets its own seat back
   * and the live game continues, it never forfeits and never takes a new seat.
   */
  joinRoom(rawCode: string, playerId: string, name: string): Room {
    if (!playerId) throw new RoomError('Missing player id.');
    const code = normaliseCode(rawCode ?? '');
    if (!code) throw new RoomError('Table codes are 5 characters.');

    const room = this.rooms.get(code);
    if (!room) throw new RoomError('No table with that code.');

    const existing = room.seats.find((s) => s.playerId === playerId);
    if (existing) {
      const wasDisconnected = !existing.connected;
      existing.connected = true;
      existing.name = sanitiseName(name);
      this.playerRooms.set(playerId, code);
      if (wasDisconnected) this.addLog(room, `${existing.name} reconnected.`);
      this.touch(room);
      return room;
    }

    if (room.seats.length >= 2) throw new RoomError('That table is full.');

    this.detach(playerId);
    const seat: MutableSeat = {
      playerId,
      name: sanitiseName(name),
      player: 'black',
      chips: this.chipsFor(playerId),
      connected: true,
    };
    room.seats.push(seat);
    this.playerRooms.set(playerId, code);

    room.game = createGame();
    room.status = 'playing';
    this.addLog(room, `${seat.name} joined. Both players roll one die for the opening.`);
    this.touch(room);
    return room;
  }

  /** Socket dropped. Keep the seat and the game; just mark them away. */
  markDisconnected(playerId: string): Room | undefined {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return undefined;
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (seat && seat.connected) {
      seat.connected = false;
      this.addLog(room, `${seat.name} disconnected. The game is held open for them.`);
    }
    this.touch(room);
    return room;
  }

  /** Deliberate exit, unlike a dropped socket. Frees the seat. */
  leaveRoom(playerId: string): Room | undefined {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return undefined;
    const seat = room.seats.find((s) => s.playerId === playerId);
    room.seats = room.seats.filter((s) => s.playerId !== playerId);
    this.playerRooms.delete(playerId);
    if (seat) this.addLog(room, `${seat.name} left the table.`);

    if (room.seats.length === 0) {
      this.rooms.delete(room.code);
    } else {
      // A game cannot continue one-handed; park the table back at waiting.
      room.game = null;
      room.status = 'waiting';
      room.rematchRequests.clear();
    }
    this.touch(room);
    return room;
  }

  /** Drops rooms nobody is connected to and nobody has touched in a while. */
  reap(now: number = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const anyoneHere = room.seats.some((s) => s.connected);
      if (!anyoneHere && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
        for (const seat of room.seats) this.playerRooms.delete(seat.playerId);
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  // ------------------------------------------------------------------ actions
  //
  // Every action below re-derives legality from the engine. The client's
  // opinion is never trusted: it supplies intent, the engine decides.

  openingRoll(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    if (game.phase !== 'opening-roll') throw new RoomError('The opening roll is already settled.');
    if (game.openingRolls[seat.player] !== undefined) {
      throw new RoomError('You have already rolled for the opening.');
    }

    const die = this.dice.rollDie();
    const opponentHadRolled = game.openingRolls[opponentOf(seat.player)] !== undefined;
    const next = applyOpeningRoll(game, seat.player, die);
    room.game = next;
    this.addLog(room, `${seat.name} rolled ${describeDie(die)} for the opening.`);

    if (opponentHadRolled) {
      if (next.phase === 'opening-roll') {
        this.addLog(room, 'Tied opening roll. Both players roll again.');
      } else if (next.roll) {
        const starter = room.seats.find((s) => s.player === next.turn);
        this.addLog(
          room,
          `${starter?.name ?? next.turn} starts and plays ${next.roll[0]} and ${next.roll[1]}.`,
        );
      }
    }

    this.touch(room);
    return room;
  }

  roll(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    this.assertTurn(game, seat.player);
    if (game.phase !== 'awaiting-roll') throw new RoomError('You cannot roll right now.');

    const dice = this.dice.rollDice();
    const next = applyRoll(game, dice);
    room.game = next;
    this.addLog(room, `${seat.name} rolled ${dice[0]} and ${dice[1]}.`);

    if (legalMovesNow(next).length === 0) {
      this.addLog(room, `${seat.name} has no legal move and must pass.`);
    }

    this.touch(room);
    return room;
  }

  move(playerId: string, move: Move): Room {
    const { room, seat, game } = this.context(playerId);
    this.assertTurn(game, seat.player);
    if (game.phase !== 'moving') throw new RoomError('You have no dice to play.');
    if (!move || typeof move !== 'object') throw new RoomError('Malformed move.');

    // applyMove re-validates against the engine's own legal-move set and
    // substitutes its canonical move object, so a client cannot lie about a hit
    // or invent a die it does not hold.
    const next = applyMove(game, move);
    room.game = next;

    const played = next.movesPlayed[next.movesPlayed.length - 1];
    if (played?.hit) {
      this.addLog(room, `${seat.name} hit a blot on ${String(played.to)}.`);
    }

    if (next.phase === 'game-over') this.settle(room);
    this.touch(room);
    return room;
  }

  undo(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    this.assertTurn(game, seat.player);
    if (game.phase !== 'moving') throw new RoomError('Nothing to undo.');
    room.game = undoLastMove(game);
    this.touch(room);
    return room;
  }

  endTurn(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    this.assertTurn(game, seat.player);
    if (game.phase !== 'moving') throw new RoomError('It is not your turn to play dice.');
    if (!canEndTurn(game)) throw new RoomError('You still have a legal move to play.');
    room.game = endTurn(game);
    this.touch(room);
    return room;
  }

  offerDouble(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    if (!canDouble(game, seat.player)) throw new RoomError('You cannot double right now.');
    const next = offerDouble(game, seat.player);
    room.game = next;
    this.addLog(room, `${seat.name} offers a double to ${next.cube.value * 2}.`);
    this.touch(room);
    return room;
  }

  respondToDouble(playerId: string, accept: boolean): Room {
    const { room, seat, game } = this.context(playerId);
    if (game.phase !== 'cube-offered') throw new RoomError('There is no double to answer.');
    if (game.turn !== seat.player) throw new RoomError('The double was not offered to you.');

    const next = respondToDouble(game, seat.player, accept);
    room.game = next;

    if (accept) {
      this.addLog(room, `${seat.name} takes. The cube is now ${next.cube.value}.`);
    } else {
      this.addLog(room, `${seat.name} passes.`);
      this.settle(room);
    }
    this.touch(room);
    return room;
  }

  resign(playerId: string): Room {
    const { room, seat, game } = this.context(playerId);
    if (game.phase === 'game-over') throw new RoomError('The game is already over.');
    room.game = resign(game, seat.player);
    this.addLog(room, `${seat.name} resigned.`);
    this.settle(room);
    this.touch(room);
    return room;
  }

  rematch(playerId: string): Room {
    const room = this.findRoomForPlayer(playerId);
    if (!room) throw new RoomError('You are not at a table.');
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) throw new RoomError('You are not seated at this table.');
    if (room.status !== 'game-over') throw new RoomError('The current game is still running.');
    if (room.seats.length < 2) throw new RoomError('Your opponent has left the table.');

    room.rematchRequests.add(seat.player);
    this.addLog(room, `${seat.name} wants a rematch.`);

    if (room.rematchRequests.size === 2) {
      room.game = createGame();
      room.status = 'playing';
      room.lastResult = null;
      room.rematchRequests.clear();
      this.addLog(room, 'New game. Both players roll one die for the opening.');
    }

    this.touch(room);
    return room;
  }

  // ---------------------------------------------------------------- snapshots

  /**
   * Per-recipient view. `legalMoves`, `canEndTurn` and `canDouble` are computed
   * server-side for this specific player and are empty/false when it is not
   * their turn, so the client never has to decide what is allowed.
   */
  snapshotFor(room: Room, playerId: string): RoomSnapshot {
    const seat = room.seats.find((s) => s.playerId === playerId);
    const game = room.game;

    let legalMoves: Move[] = [];
    let mayEndTurn = false;
    let mayDouble = false;

    if (game && seat) {
      if (game.phase === 'moving' && game.turn === seat.player) {
        legalMoves = legalMovesNow(game);
        mayEndTurn = canEndTurn(game);
      }
      mayDouble = canDouble(game, seat.player);
    }

    const seats: Seat[] = room.seats.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      player: s.player,
      chips: s.chips,
      connected: s.connected,
    }));

    return {
      code: room.code,
      status: room.status,
      stake: room.stake,
      seats,
      you: seat?.player ?? null,
      game,
      legalMoves,
      canEndTurn: mayEndTurn,
      canDouble: mayDouble,
      log: room.log,
      lastResult: room.lastResult,
      rematchRequestedBy: [...room.rematchRequests],
    };
  }

  // ------------------------------------------------------------------ private

  private context(playerId: string): { room: Room; seat: MutableSeat; game: GameState } {
    const room = this.findRoomForPlayer(playerId);
    if (!room) throw new RoomError('You are not at a table.');
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) throw new RoomError('You are not seated at this table.');
    if (!room.game) throw new RoomError('The game has not started yet.');
    return { room, seat, game: room.game };
  }

  private assertTurn(game: GameState, player: Player): void {
    if (game.phase === 'game-over') throw new RoomError('The game is over.');
    if (game.turn !== player) throw new RoomError('It is not your turn.');
  }

  /**
   * Chips move only here. Stake is per point; points are the cube value times
   * the gammon/backgammon multiplier. The transfer is clamped to what the loser
   * actually holds so a balance can never go negative.
   *
   * These are virtual chips. They are not currency, cannot be purchased, and
   * cannot be cashed out.
   */
  private settle(room: Room): void {
    const game = room.game;
    if (!game || game.phase !== 'game-over' || !game.winner || !game.winType) return;

    // Hoisted out of the closures below: narrowing on `game.winner` does not
    // survive into a callback, because TypeScript cannot prove when it runs.
    const winner = game.winner;
    const winnerSeat = room.seats.find((s) => s.player === winner);
    const loserSeat = room.seats.find((s) => s.player === opponentOf(winner));
    const points = pointsWon(game);

    let chips = 0;
    if (winnerSeat && loserSeat) {
      chips = Math.max(0, Math.min(room.stake * points, loserSeat.chips));
      loserSeat.chips -= chips;
      winnerSeat.chips += chips;
      this.bank.set(loserSeat.playerId, loserSeat.chips);
      this.bank.set(winnerSeat.playerId, winnerSeat.chips);
    }

    room.status = 'game-over';
    room.rematchRequests.clear();
    room.lastResult = {
      winner,
      winnerName: winnerSeat?.name ?? winner,
      winType: game.winType,
      cubeValue: game.cube.value,
      points,
      chips,
    };

    const how =
      game.winReason === 'cube-pass'
        ? 'by a passed double'
        : game.winReason === 'resign'
          ? 'by resignation'
          : `by ${game.winType}`;
    this.addLog(
      room,
      `${winnerSeat?.name ?? winner} wins ${points} point${points === 1 ? '' : 's'} ${how} and takes ${chips} chips.`,
    );
  }

  private addLog(room: Room, text: string): void {
    room.log = [...room.log, { id: room.nextLogId, text }].slice(-MAX_LOG_ENTRIES);
    room.nextLogId += 1;
  }

  private touch(room: Room): void {
    room.lastActivityAt = Date.now();
  }

  /** Removes a player from whatever table they were previously at. */
  private detach(playerId: string): void {
    const previous = this.findRoomForPlayer(playerId);
    if (!previous) return;
    previous.seats = previous.seats.filter((s) => s.playerId !== playerId);
    this.playerRooms.delete(playerId);
    if (previous.seats.length === 0) {
      this.rooms.delete(previous.code);
    } else {
      previous.game = null;
      previous.status = 'waiting';
      previous.rematchRequests.clear();
    }
  }
}
