import type { DieValue, GameState, Player } from '../engine/types';
import type { RoomSnapshot, Seat } from '../shared/protocol';

export type ClassPart = string | false | null | undefined;

export function cx(...parts: ClassPart[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

export function seatOf(snapshot: RoomSnapshot, player: Player | null): Seat | null {
  if (player === null) return null;
  return snapshot.seats.find((s) => s.player === player) ?? null;
}

/**
 * The colour the board is drawn from. A seated player sees their own; anyone
 * unseated — the watcher of a Jev table — gets white, which is the seat Jev
 * always takes and therefore the one rendered at the bottom.
 */
export function viewerOf(snapshot: RoomSnapshot): Player {
  return snapshot.you ?? 'white';
}

/**
 * The seat on the near side of the board. Looked up by the VIEWING colour, not
 * by `snapshot.you`: for a watcher `you` is null, and resolving the near seat
 * from it would render Jev's occupied seat as an empty one.
 */
export function viewerSeatOf(snapshot: RoomSnapshot): Seat | null {
  return seatOf(snapshot, viewerOf(snapshot));
}

export function otherPlayer(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

/** Name we can put in a sentence even before the second seat is filled. */
export function nameOf(seat: Seat | null, fallback: string): string {
  const name = seat?.name.trim() ?? '';
  return name.length > 0 ? name : fallback;
}

export interface DieFace {
  readonly value: DieValue;
  readonly spent: boolean;
  readonly key: string;
}

/**
 * `game.dice` is the full expanded roll and is never shortened; dice are spent
 * by appearing in `movesPlayed`. Walk the roll marking one die spent per move
 * of that value so doubles show three live and one struck, not all four.
 */
export function diceFaces(game: GameState): DieFace[] {
  const used = new Map<DieValue, number>();
  for (const move of game.movesPlayed) {
    used.set(move.die, (used.get(move.die) ?? 0) + 1);
  }
  return game.dice.map((value, i) => {
    const remaining = used.get(value) ?? 0;
    if (remaining > 0) {
      used.set(value, remaining - 1);
      return { value, spent: true, key: `${i}-${value}` };
    }
    return { value, spent: false, key: `${i}-${value}` };
  });
}

export interface RollSummary {
  /** Four identical faces. The engine expands a double into four dice. */
  readonly isDouble: boolean;
  /** The repeated face when `isDouble`, otherwise null. */
  readonly value: DieValue | null;
  readonly total: number;
  readonly remaining: number;
  /** Terse count for the badge, e.g. "3 of 4 left". */
  readonly countLabel: string;
  /** One sentence covering the whole roll, for the dice group's aria-label. */
  readonly label: string;
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four'] as const;

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * What the dice actually mean this turn, derived from the faces alone so it is
 * pure and testable. Doubles are the case worth calling out: four faces read at
 * a glance as "some dice" rather than "four moves", so the UI needs a badge and
 * a count, not just more pips.
 */
export function rollSummary(faces: readonly DieFace[]): RollSummary {
  const first = faces[0]?.value ?? null;
  const total = faces.length;
  const isDouble = total === 4 && faces.every((f) => f.value === first);
  const remaining = faces.reduce((n, f) => (f.spent ? n : n + 1), 0);
  const countLabel =
    remaining === 0 ? `all ${total} played` : `${remaining} of ${total} left`;

  if (isDouble && first !== null) {
    const tail =
      remaining === 0 ? 'all four played' : `${countWord(remaining)} of four still to play`;
    return {
      isDouble,
      value: first,
      total,
      remaining,
      countLabel,
      label: `Double ${first}s — four moves, ${tail}.`,
    };
  }

  const values = faces.map((f) => f.value).join(' and ');
  const tail =
    remaining === 0
      ? 'all played'
      : `${countWord(remaining)} of ${countWord(total)} still to play`;
  return {
    isDouble: false,
    value: null,
    total,
    remaining,
    countLabel,
    label: `Rolled ${values} — ${tail}.`,
  };
}

export function winTypeLabel(winType: 'single' | 'gammon' | 'backgammon'): string {
  if (winType === 'gammon') return 'Gammon';
  if (winType === 'backgammon') return 'Backgammon';
  return 'Single game';
}

export function winTypeDetail(winType: 'single' | 'gammon' | 'backgammon'): string {
  if (winType === 'gammon') return 'Loser bore off nothing. Doubles the cube value.';
  if (winType === 'backgammon') {
    return 'Loser bore off nothing and was still trapped. Triples the cube value.';
  }
  return 'Loser bore off at least one checker.';
}

export function reasonLabel(reason: GameState['winReason']): string {
  if (reason === 'cube-pass') return 'Double declined';
  if (reason === 'resign') return 'Resigned';
  if (reason === 'bear-off') return 'Bore off all fifteen';
  return '';
}

/** Plural without a library and without an apostrophe catastrophe. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

