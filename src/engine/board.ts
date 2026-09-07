/**
 * Board primitives for the pure rules engine.
 *
 * Direction is encoded in exactly one place: `distanceToOff`. Everything else
 * (movement, entry, bearing off, pip count) is expressed in terms of distance,
 * so no other function needs to know which way a colour travels.
 */

import {
  IllegalMoveError,
  type BoardState,
  type DieValue,
  type Move,
  type MovePoint,
  type Player,
  type PointState,
  type WinType,
} from './types';

const POINT_COUNT = 24;

/** Shared because `PointState` is immutable by contract; never mutated in place. */
const EMPTY_POINT: PointState = { color: null, count: 0 };

function opponent(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

export function emptyBoard(): BoardState {
  return {
    points: new Array<PointState>(POINT_COUNT).fill(EMPTY_POINT),
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 },
  };
}

export function initialBoard(): BoardState {
  return makeBoard({
    white: { 24: 2, 13: 5, 8: 3, 6: 5 },
    black: { 1: 2, 12: 5, 17: 3, 19: 5 },
  });
}

export function makeBoard(spec: {
  white?: Record<number, number>;
  black?: Record<number, number>;
  whiteBar?: number;
  blackBar?: number;
  whiteOff?: number;
  blackOff?: number;
}): BoardState {
  const points = new Array<PointState>(POINT_COUNT).fill(EMPTY_POINT);

  const place = (color: Player, map: Record<number, number> | undefined): void => {
    if (!map) return;
    for (const [rawPoint, rawCount] of Object.entries(map)) {
      const point = Number(rawPoint);
      if (!Number.isInteger(point) || point < 1 || point > POINT_COUNT) {
        throw new RangeError(`makeBoard: point ${rawPoint} is outside 1..24`);
      }
      if (rawCount <= 0) continue;
      const existing = points[point - 1];
      if (existing && existing.color !== null && existing.color !== color) {
        throw new IllegalMoveError(
          `makeBoard: point ${point} was given to both colours`,
        );
      }
      points[point - 1] = { color, count: rawCount };
    }
  };

  place('white', spec.white);
  place('black', spec.black);

  return {
    points,
    bar: { white: spec.whiteBar ?? 0, black: spec.blackBar ?? 0 },
    off: { white: spec.whiteOff ?? 0, black: spec.blackOff ?? 0 },
  };
}

export function pointAt(board: BoardState, point: number): PointState {
  if (!Number.isInteger(point) || point < 1 || point > POINT_COUNT) {
    throw new RangeError(`Point ${point} is outside 1..24`);
  }
  return board.points[point - 1] ?? EMPTY_POINT;
}

export function distanceToOff(player: Player, at: MovePoint): number {
  if (at === 'bar') return 25;
  if (at === 'off') return 0;
  return player === 'white' ? at : 25 - at;
}

export function moveDistance(player: Player, from: MovePoint, to: MovePoint): number {
  return distanceToOff(player, from) - distanceToOff(player, to);
}

export function entryPoint(player: Player, die: DieValue): number {
  return player === 'white' ? 25 - die : die;
}

export function homeBoardPoints(player: Player): number[] {
  return player === 'white' ? [1, 2, 3, 4, 5, 6] : [19, 20, 21, 22, 23, 24];
}

export function isBlocked(board: BoardState, player: Player, point: number): boolean {
  const state = pointAt(board, point);
  return state.color !== null && state.color !== player && state.count >= 2;
}

export function checkersOnBoard(board: BoardState, player: Player): number {
  let total = 0;
  for (const point of board.points) {
    if (point.color === player) total += point.count;
  }
  return total;
}

export function allCheckersHome(board: BoardState, player: Player): boolean {
  if (board.bar[player] > 0) return false;
  for (let point = 1; point <= POINT_COUNT; point += 1) {
    const state = board.points[point - 1];
    if (!state || state.color !== player || state.count === 0) continue;
    if (distanceToOff(player, point) > 6) return false;
  }
  return true;
}

export function pipCount(board: BoardState, player: Player): number {
  let pips = board.bar[player] * 25;
  for (let point = 1; point <= POINT_COUNT; point += 1) {
    const state = board.points[point - 1];
    if (!state || state.color !== player) continue;
    pips += state.count * distanceToOff(player, point);
  }
  return pips;
}

export function cloneBoard(board: BoardState): BoardState {
  return {
    points: board.points.map((point) => ({ color: point.color, count: point.count })),
    bar: { ...board.bar },
    off: { ...board.off },
  };
}

/**
 * Canonical position string: 24 point codes then bar and off counts.
 *
 * Used as the memo key for the move search and to decide when two different
 * move orders are the same play, so it must capture every bit of position state
 * and nothing else. One character per slot rather than a readable format,
 * because the search calls this once per node and it dominates the profile.
 * Codes are offset into printable ASCII: empty 0, white `count`, black
 * `16 + count`, all counts capped by the 15 checkers a side owns.
 */
const KEY_CODE_BASE = 48;

export function boardKey(board: BoardState): string {
  const codes = new Array<number>(POINT_COUNT + 4);
  for (let i = 0; i < POINT_COUNT; i += 1) {
    const point = board.points[i];
    if (!point || point.color === null || point.count === 0) {
      codes[i] = KEY_CODE_BASE;
    } else {
      codes[i] =
        KEY_CODE_BASE + (point.color === 'white' ? point.count : 16 + point.count);
    }
  }
  codes[POINT_COUNT] = KEY_CODE_BASE + board.bar.white;
  codes[POINT_COUNT + 1] = KEY_CODE_BASE + board.bar.black;
  codes[POINT_COUNT + 2] = KEY_CODE_BASE + board.off.white;
  codes[POINT_COUNT + 3] = KEY_CODE_BASE + board.off.black;
  return String.fromCharCode(...codes);
}

export function applyMoveToBoard(
  board: BoardState,
  player: Player,
  move: Move,
): BoardState {
  const points = board.points.slice();
  const bar = { ...board.bar };
  const off = { ...board.off };
  const foe = opponent(player);

  if (move.from === 'bar') {
    bar[player] -= 1;
  } else if (typeof move.from === 'number') {
    const index = move.from - 1;
    const source = points[index];
    if (source) {
      const count = source.count - 1;
      points[index] = count > 0 ? { color: source.color, count } : EMPTY_POINT;
    }
  }

  if (move.to === 'off') {
    off[player] += 1;
  } else if (typeof move.to === 'number') {
    const index = move.to - 1;
    let dest = points[index] ?? EMPTY_POINT;
    if (move.hit && dest.color === foe) {
      bar[foe] += 1;
      dest = dest.count > 1 ? { color: foe, count: dest.count - 1 } : EMPTY_POINT;
    }
    points[index] =
      dest.color === player
        ? { color: player, count: dest.count + 1 }
        : { color: player, count: 1 };
  }

  return { points, bar, off };
}

export function winTypeFor(board: BoardState, winner: Player): WinType {
  const loser = opponent(winner);
  if (board.off[loser] > 0) return 'single';
  if (board.bar[loser] > 0) return 'backgammon';
  for (const point of homeBoardPoints(winner)) {
    const state = board.points[point - 1];
    if (state && state.color === loser && state.count > 0) return 'backgammon';
  }
  return 'gammon';
}
