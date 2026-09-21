/**
 * Turns a position and a candidate play into the structured facts Jev is asked
 * to choose between.
 *
 * Everything here is computed from the board by this codebase — notation,
 * counts, pip totals, shot counts. Nothing is generated text and nothing comes
 * back from a model, which is what keeps the decision panel free of prose: the
 * label the panel shows for a chosen option is the same string this module
 * built before the question was ever sent.
 *
 * Pure and dependency-free apart from the engine, so it unit tests board by
 * board like the rest of `src/server/ai`.
 */

import {
  applyMoveToBoard,
  pipCount,
  type BoardState,
  type Move,
  type MovePoint,
  type Player,
} from '../../../engine';
import { countShotsAtAny } from '../shots';

function opponentOf(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

function pointLabel(point: MovePoint): string {
  return typeof point === 'number' ? String(point) : point;
}

/**
 * One hop in the usual `from/to` shorthand, with `*` for a hit. Points use the
 * engine's absolute 1..24 numbering rather than per-player numbering, because
 * that is what the board state in the question already uses — mixing the two
 * would be the one ambiguity a model could not resolve from context.
 */
export function describeMove(move: Move): string {
  return `${pointLabel(move.from)}/${pointLabel(move.to)}${move.hit ? '*' : ''}`;
}

export function describeSequence(sequence: readonly Move[]): string {
  return sequence.length === 0 ? 'no play' : sequence.map(describeMove).join(' ');
}

export function applySequence(
  board: BoardState,
  player: Player,
  sequence: readonly Move[],
): BoardState {
  let next = board;
  for (const move of sequence) next = applyMoveToBoard(next, player, move);
  return next;
}

/** Points held with two or more checkers: the ones an opponent cannot land on. */
export function madePoints(board: BoardState, player: Player): number {
  let count = 0;
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (state && state.color === player && state.count >= 2) count += 1;
  }
  return count;
}

/** Longest run of consecutive made points. Six in a row is a closed prime. */
export function longestPrime(board: BoardState, player: Player): number {
  let best = 0;
  let run = 0;
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (state && state.color === player && state.count >= 2) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export function blotPoints(board: BoardState, player: Player): number[] {
  const blots: number[] = [];
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (state && state.color === player && state.count === 1) blots.push(p);
  }
  return blots;
}

/**
 * How many of the opponent's 36 rolls hit at least one of `player`'s blots.
 * The union, via `countShotsAtAny`, rather than a sum of per-blot shot counts:
 * two blots covered by the same number are one thing that can go wrong, and
 * summing would make a position look far worse than it plays.
 */
export function shotsAgainst(board: BoardState, player: Player): number {
  return countShotsAtAny(board, opponentOf(player), blotPoints(board, player));
}

/**
 * The facts a candidate play is judged on. Field names are the question's
 * vocabulary, so they read as a sentence when the model sees them alongside the
 * instructions.
 */
export interface PlayFacts {
  readonly play: string;
  readonly hits_opponent_blots: number;
  readonly your_blots_after: number;
  readonly opponent_rolls_that_hit_you: number;
  readonly points_you_hold: number;
  readonly your_longest_prime: number;
  readonly your_pips_after: number;
  readonly opponent_pips_after: number;
  readonly your_checkers_on_bar_after: number;
  readonly opponent_checkers_on_bar_after: number;
  readonly you_borne_off_after: number;
}

export function describePlay(
  turnStartBoard: BoardState,
  player: Player,
  sequence: readonly Move[],
): PlayFacts {
  const opponent = opponentOf(player);
  const after = applySequence(turnStartBoard, player, sequence);

  return {
    play: describeSequence(sequence),
    hits_opponent_blots: sequence.reduce((n, move) => (move.hit ? n + 1 : n), 0),
    your_blots_after: blotPoints(after, player).length,
    opponent_rolls_that_hit_you: shotsAgainst(after, player),
    points_you_hold: madePoints(after, player),
    your_longest_prime: longestPrime(after, player),
    your_pips_after: pipCount(after, player),
    opponent_pips_after: pipCount(after, opponent),
    your_checkers_on_bar_after: after.bar[player],
    opponent_checkers_on_bar_after: after.bar[opponent],
    you_borne_off_after: after.off[player],
  };
}
