/**
 * shots.ts - "how many of the 36 rolls let `hitter` hit a blot at `target`."
 *
 * Every expected count below is worked out by hand from the dice, not copied
 * from the implementation, so a regression that changes the answer fails
 * loudly. See the file comment on `countShots` for why this deliberately
 * ignores the "maximal sequence" and "must play both dice" rules.
 */
import { describe, expect, it } from 'vitest';

import { emptyBoard, makeBoard } from '../../engine';
import { countShots } from './shots';

describe('countShots', () => {
  it('counts direct and combination shots on an open board', () => {
    // From point 1, black reaches point 6 (distance 5) directly with any 5,
    // or via the two-die combinations (1,4) and (2,3), or via double 5.
    // 7 qualifying non-double rolls * 2 + 1 qualifying double = 15.
    const board = makeBoard({ black: { 1: 2 } });
    expect(countShots(board, 'black', 6)).toBe(15);
  });

  it('is zero once the hitter has already moved past the target', () => {
    // Black only moves upward (1 -> 24), so a checker on 10 can never land
    // back on 6.
    const board = makeBoard({ black: { 10: 2 } });
    expect(countShots(board, 'black', 6)).toBe(0);
  });

  it('is zero when the hitter has no checkers on the board or the bar', () => {
    expect(countShots(emptyBoard(), 'black', 6)).toBe(0);
  });

  it('mirrors correctly for white, who moves the other way', () => {
    // White 24 -> point 19 is the exact mirror of black 1 -> point 6.
    const board = makeBoard({ white: { 24: 2 } });
    expect(countShots(board, 'white', 19)).toBe(15);
  });

  it('counts entries from the bar, including two-die combination entries', () => {
    // Direct: any roll containing a 6 (entryPoint(black, 6) === 6) = 11.
    // Combination entries summing to 6 without a 6 present: (1,5) and (2,4) = 4.
    // Doubles that reach 6 by entering then continuing: double 2 (2+2+2) and
    // double 3 (3+3) = 2. Total 11 + 4 + 2 = 17.
    const board = makeBoard({ blackBar: 1 });
    expect(countShots(board, 'black', 6)).toBe(17);
  });

  it('drops to zero once every intermediate landing is blocked', () => {
    // Point 8 is distance 7 from point 1 - too far for any direct die, so
    // every shot is a two-die combination: (1,6), (2,5), (3,4), each with two
    // possible intermediate landings depending on which die is played first.
    const open = makeBoard({ black: { 1: 2 } });
    expect(countShots(open, 'black', 8)).toBe(6);

    // Every point that could serve as an intermediate landing for any of
    // those three combinations (2..7) is now a made white point, so none of
    // them can be played through in either order.
    const blocked = makeBoard({
      black: { 1: 2 },
      white: { 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2 },
    });
    expect(countShots(blocked, 'black', 8)).toBe(0);
  });
});
