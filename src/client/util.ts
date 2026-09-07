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

