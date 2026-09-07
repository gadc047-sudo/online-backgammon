/**
 * evaluate.ts - heuristic board scoring for the computer opponent.
 *
 * These are sanity properties, not a claim that the weights are "correct" in
 * any absolute sense: symmetry, and the direction of each feature (race,
 * bar, blot risk, structure, prime, anchor). Every non-symmetry fixture below
 * holds the OTHER features constant (same total checkers, same pip cost, or
 * both) so the one feature under test cannot be swamped by an unrelated race
 * difference between the two boards being compared.
 */
import { describe, expect, it } from 'vitest';

import { initialBoard, makeBoard } from '../../engine';
import { evaluateBoard } from './evaluate';

describe('evaluateBoard', () => {
  it('is zero-sum: scoring from either side mirrors exactly', () => {
    const board = initialBoard();
    expect(evaluateBoard(board, 'white')).toBeCloseTo(-evaluateBoard(board, 'black'), 10);
  });

  it('is symmetric on an arbitrary asymmetric position too', () => {
    const board = makeBoard({
      white: { 24: 2, 13: 3, 8: 2, 6: 4, 3: 1 },
      black: { 1: 2, 12: 4, 17: 2, 19: 5, 22: 1 },
    });
    expect(evaluateBoard(board, 'white')).toBeCloseTo(-evaluateBoard(board, 'black'), 10);
  });

  it('is exactly zero on the opening position for both sides', () => {
    const board = initialBoard();
    expect(evaluateBoard(board, 'white')).toBe(0);
    expect(evaluateBoard(board, 'black')).toBe(0);
  });

  it('rewards a pip lead when the checker count is otherwise equal', () => {
    const ahead = makeBoard({ white: { 6: 2 }, black: { 19: 2 } });
    const behind = makeBoard({ white: { 10: 2 }, black: { 19: 2 } });
    expect(evaluateBoard(ahead, 'white')).toBeGreaterThan(evaluateBoard(behind, 'white'));
  });

  it('rewards having more checkers borne off', () => {
    const aheadOnBearOff = makeBoard({
      white: { 6: 1 },
      black: { 19: 1 },
      whiteOff: 14,
      blackOff: 14,
    });
    const level = makeBoard({ white: { 6: 1 }, black: { 19: 1 }, whiteOff: 13, blackOff: 14 });
    expect(evaluateBoard(aheadOnBearOff, 'white')).toBeGreaterThan(evaluateBoard(level, 'white'));
  });

  it('penalises a checker of ours stuck on the bar', () => {
    const onBar = makeBoard({ white: { 6: 1 }, black: { 19: 2 }, whiteBar: 1 });
    const notOnBar = makeBoard({ white: { 6: 2 }, black: { 19: 2 } });
    expect(evaluateBoard(onBar, 'white')).toBeLessThan(evaluateBoard(notOnBar, 'white'));
  });

  it('penalises a blot exposed to shots more than an equally-costly but unreachable one', () => {
    // Same white blot (point 6, pip 6 either way) and the same total black pip
    // cost (58 either way): only whether black can actually reach it differs.
    // Black on 1 and 20 can reach 6 (from 1, several rolls); black on 10 and 11
    // cannot (black only moves upward, and both sit past the target already).
    const exposed = makeBoard({ white: { 6: 1 }, black: { 1: 2, 20: 2 } });
    const safer = makeBoard({ white: { 6: 1 }, black: { 10: 2, 11: 2 } });
    expect(evaluateBoard(exposed, 'white')).toBeLessThan(evaluateBoard(safer, 'white'));
  });

  it('rewards made points over blots holding the same total checkers', () => {
    const madePoints = makeBoard({ white: { 8: 2, 6: 2 }, black: { 19: 2 } });
    const blots = makeBoard({ white: { 8: 1, 7: 1, 6: 1, 5: 1 }, black: { 19: 2 } });
    expect(evaluateBoard(madePoints, 'white')).toBeGreaterThan(evaluateBoard(blots, 'white'));
  });

  it('gives extra credit for a longer prime over the same checkers scattered', () => {
    // Same six checkers, same total pip cost (21 points either way): only
    // whether the three made points are consecutive differs.
    const consecutive = makeBoard({ white: { 6: 2, 7: 2, 8: 2 }, black: { 19: 2 } });
    const scattered = makeBoard({ white: { 5: 2, 7: 2, 9: 2 }, black: { 19: 2 } });
    expect(evaluateBoard(consecutive, 'white')).toBeGreaterThan(evaluateBoard(scattered, 'white'));
  });

  it('rewards an anchor in the opponent home board', () => {
    // Point 19 is the cheapest point still inside black's home board; point 18
    // is just outside it, one pip cheaper, so the race difference this leaves
    // between the two boards is tiny next to the anchor bonus.
    const anchored = makeBoard({ white: { 19: 2, 6: 3 }, black: { 1: 3 } });
    const noAnchor = makeBoard({ white: { 18: 2, 6: 3 }, black: { 1: 3 } });
    expect(evaluateBoard(anchored, 'white')).toBeGreaterThan(evaluateBoard(noAnchor, 'white'));
  });
});
