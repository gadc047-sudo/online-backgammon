/**
 * board.ts — geometry, fixtures, pip counting, single-hop application.
 *
 * Derived only from src/engine/CONTRACT.md + src/engine/types.ts.
 *
 * Geometry under test (the single asymmetry that breeds bugs):
 *   white  moves 24 -> 1,  home 1..6,    distanceToOff(p) = p,      entry = 25 - die
 *   black  moves 1  -> 24, home 19..24,  distanceToOff(p) = 25 - p, entry = die
 * Every geometric assertion below is written for BOTH colours on purpose.
 */

import {
  PLAYERS,
  allCheckersHome,
  applyMoveToBoard,
  boardKey,
  checkersOnBoard,
  cloneBoard,
  distanceToOff,
  emptyBoard,
  entryPoint,
  homeBoardPoints,
  initialBoard,
  isBlocked,
  makeBoard,
  moveDistance,
  pipCount,
  pointAt,
  winTypeFor,
} from './index';
import type { BoardState, DieValue, Player } from './index';

const DICE: readonly DieValue[] = [1, 2, 3, 4, 5, 6];

/** Total checkers a player owns anywhere: points + bar + off. Must always be 15. */
function totalCheckers(board: BoardState, player: Player): number {
  let n = board.bar[player] + board.off[player];
  for (const p of board.points) {
    if (p.color === player) n += p.count;
  }
  return n;
}

describe('emptyBoard', () => {
  it('has 24 empty points and nothing on the bar or off', () => {
    const b = emptyBoard();
    expect(b.points).toHaveLength(24);
    for (let p = 1; p <= 24; p++) {
      expect(pointAt(b, p)).toEqual({ color: null, count: 0 });
    }
    expect(b.bar).toEqual({ white: 0, black: 0 });
    expect(b.off).toEqual({ white: 0, black: 0 });
  });
});

describe('initialBoard', () => {
  it('places the standard opening position and nothing else', () => {
    const b = initialBoard();
    // White: 2 on 24, 5 on 13, 3 on 8, 5 on 6. Black: 2 on 1, 5 on 12, 3 on 17, 5 on 19.
    const expected: Record<number, { color: Player; count: number }> = {
      24: { color: 'white', count: 2 },
      13: { color: 'white', count: 5 },
      8: { color: 'white', count: 3 },
      6: { color: 'white', count: 5 },
      1: { color: 'black', count: 2 },
      12: { color: 'black', count: 5 },
      17: { color: 'black', count: 3 },
      19: { color: 'black', count: 5 },
    };
    for (let p = 1; p <= 24; p++) {
      const want = expected[p] ?? { color: null, count: 0 };
      expect(pointAt(b, p)).toEqual(want);
    }
  });

  it('has an empty bar and nothing borne off', () => {
    const b = initialBoard();
    expect(b.bar.white).toBe(0);
    expect(b.bar.black).toBe(0);
    expect(b.off.white).toBe(0);
    expect(b.off.black).toBe(0);
  });

  it('gives each side exactly 15 checkers', () => {
    const b = initialBoard();
    expect(totalCheckers(b, 'white')).toBe(15);
    expect(totalCheckers(b, 'black')).toBe(15);
  });

  it('is a fresh object on every call', () => {
    expect(initialBoard()).not.toBe(initialBoard());
    expect(initialBoard()).toEqual(initialBoard());
  });
});

describe('pointAt', () => {
  it('is 1-indexed against points[0]', () => {
    const b = makeBoard({ white: { 1: 3 }, black: { 24: 4 } });
    expect(pointAt(b, 1)).toEqual({ color: 'white', count: 3 });
    expect(pointAt(b, 24)).toEqual({ color: 'black', count: 4 });
    expect(b.points[0]).toEqual({ color: 'white', count: 3 });
    expect(b.points[23]).toEqual({ color: 'black', count: 4 });
  });

  it('throws RangeError outside 1..24', () => {
    const b = emptyBoard();
    expect(() => pointAt(b, 0)).toThrow(RangeError);
    expect(() => pointAt(b, 25)).toThrow(RangeError);
    expect(() => pointAt(b, -1)).toThrow(RangeError);
  });
});

describe('makeBoard', () => {
  it('builds bar and off counters', () => {
    const b = makeBoard({
      white: { 6: 2 },
      black: { 19: 2 },
      whiteBar: 1,
      blackBar: 3,
      whiteOff: 5,
      blackOff: 4,
    });
    expect(b.bar).toEqual({ white: 1, black: 3 });
    expect(b.off).toEqual({ white: 5, black: 4 });
    expect(pointAt(b, 6)).toEqual({ color: 'white', count: 2 });
    expect(pointAt(b, 19)).toEqual({ color: 'black', count: 2 });
  });

  it('rejects a point claimed by both colours', () => {
    expect(() => makeBoard({ white: { 5: 2 }, black: { 5: 1 } })).toThrow();
    expect(() => makeBoard({ white: { 13: 1 }, black: { 13: 1 } })).toThrow();
  });

  it('accepts disjoint point sets', () => {
    expect(() => makeBoard({ white: { 5: 2 }, black: { 6: 1 } })).not.toThrow();
  });
});

describe('distanceToOff', () => {
  it('treats the bar as 25 and off as 0 for both colours', () => {
    for (const player of PLAYERS) {
      expect(distanceToOff(player, 'bar')).toBe(25);
      expect(distanceToOff(player, 'off')).toBe(0);
    }
  });

  it('is p for white and 25 - p for black', () => {
    expect(distanceToOff('white', 24)).toBe(24);
    expect(distanceToOff('white', 13)).toBe(13);
    expect(distanceToOff('white', 6)).toBe(6);
    expect(distanceToOff('white', 1)).toBe(1);

    expect(distanceToOff('black', 1)).toBe(24);
    expect(distanceToOff('black', 12)).toBe(13);
    expect(distanceToOff('black', 19)).toBe(6);
    expect(distanceToOff('black', 24)).toBe(1);
  });

  it('is mirror-symmetric: white at p equals black at 25 - p', () => {
    for (let p = 1; p <= 24; p++) {
      expect(distanceToOff('white', p)).toBe(distanceToOff('black', 25 - p));
    }
  });
});

describe('moveDistance', () => {
  it('is positive along the legal direction of travel', () => {
    expect(moveDistance('white', 24, 18)).toBe(6);
    expect(moveDistance('white', 13, 11)).toBe(2);
    expect(moveDistance('black', 1, 7)).toBe(6);
    expect(moveDistance('black', 12, 14)).toBe(2);
  });

  it('is negative when travelling backwards', () => {
    expect(moveDistance('white', 6, 13)).toBe(-7);
    expect(moveDistance('black', 19, 12)).toBe(-7);
  });

  it('handles bar entry distances', () => {
    // white enters onto 25 - die, black onto die; both are `die` pips from the bar.
    expect(moveDistance('white', 'bar', 22)).toBe(3);
    expect(moveDistance('white', 'bar', 19)).toBe(6);
    expect(moveDistance('black', 'bar', 3)).toBe(3);
    expect(moveDistance('black', 'bar', 6)).toBe(6);
  });

  it('handles bear-off distances', () => {
    expect(moveDistance('white', 6, 'off')).toBe(6);
    expect(moveDistance('white', 1, 'off')).toBe(1);
    expect(moveDistance('black', 19, 'off')).toBe(6);
    expect(moveDistance('black', 24, 'off')).toBe(1);
  });
});

describe('entryPoint', () => {
  it('maps white dice onto 24..19', () => {
    expect(entryPoint('white', 1)).toBe(24);
    expect(entryPoint('white', 2)).toBe(23);
    expect(entryPoint('white', 3)).toBe(22);
    expect(entryPoint('white', 4)).toBe(21);
    expect(entryPoint('white', 5)).toBe(20);
    expect(entryPoint('white', 6)).toBe(19);
  });

  it('maps black dice onto 1..6', () => {
    expect(entryPoint('black', 1)).toBe(1);
    expect(entryPoint('black', 2)).toBe(2);
    expect(entryPoint('black', 3)).toBe(3);
    expect(entryPoint('black', 4)).toBe(4);
    expect(entryPoint('black', 5)).toBe(5);
    expect(entryPoint('black', 6)).toBe(6);
  });

  it('agrees with moveDistance from the bar for every die and colour', () => {
    for (const player of PLAYERS) {
      for (const die of DICE) {
        expect(moveDistance(player, 'bar', entryPoint(player, die))).toBe(die);
      }
    }
  });
});

describe('homeBoardPoints', () => {
  it('is 1..6 for white and 19..24 for black', () => {
    expect(homeBoardPoints('white')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(homeBoardPoints('black')).toEqual([19, 20, 21, 22, 23, 24]);
  });

  it('contains exactly the points at distance 1..6', () => {
    for (const player of PLAYERS) {
      for (const p of homeBoardPoints(player)) {
        expect(distanceToOff(player, p)).toBeLessThanOrEqual(6);
        expect(distanceToOff(player, p)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('isBlocked', () => {
  it('is true only when the point holds 2 or more opposing checkers', () => {
    const b = makeBoard({ black: { 8: 2, 9: 1, 10: 5 }, white: { 11: 3 } });
    expect(isBlocked(b, 'white', 8)).toBe(true); // made point
    expect(isBlocked(b, 'white', 9)).toBe(false); // blot, hittable
    expect(isBlocked(b, 'white', 10)).toBe(true);
    expect(isBlocked(b, 'white', 11)).toBe(false); // own checkers never block
    expect(isBlocked(b, 'white', 12)).toBe(false); // empty
  });

  it('is symmetric for black', () => {
    const b = makeBoard({ white: { 3: 2, 4: 1 }, black: { 5: 6 } });
    expect(isBlocked(b, 'black', 3)).toBe(true);
    expect(isBlocked(b, 'black', 4)).toBe(false);
    expect(isBlocked(b, 'black', 5)).toBe(false);
    expect(isBlocked(b, 'black', 6)).toBe(false);
  });
});

describe('checkersOnBoard', () => {
  it('counts a player s checkers sitting on points', () => {
    const b = makeBoard({ white: { 13: 5, 8: 3 }, black: { 19: 2 } });
    expect(checkersOnBoard(b, 'white')).toBe(8);
    expect(checkersOnBoard(b, 'black')).toBe(2);
  });

  it('is zero for a player with no checkers on points', () => {
    const b = makeBoard({ white: { 6: 2 } });
    expect(checkersOnBoard(b, 'black')).toBe(0);
  });
});

describe('allCheckersHome', () => {
  it('is true when every checker sits in the home board', () => {
    expect(allCheckersHome(makeBoard({ white: { 1: 2, 6: 13 } }), 'white')).toBe(true);
    expect(allCheckersHome(makeBoard({ black: { 19: 8, 24: 7 } }), 'black')).toBe(true);
  });

  it('is false when a checker sits outside the home board', () => {
    // Point 7 is one pip outside white's home; point 18 is one pip outside black's.
    expect(allCheckersHome(makeBoard({ white: { 1: 14, 7: 1 } }), 'white')).toBe(false);
    expect(allCheckersHome(makeBoard({ black: { 24: 14, 18: 1 } }), 'black')).toBe(false);
  });

  it('is false when a checker is on the bar, even if all others are home', () => {
    expect(allCheckersHome(makeBoard({ white: { 1: 14 }, whiteBar: 1 }), 'white')).toBe(false);
    expect(allCheckersHome(makeBoard({ black: { 24: 14 }, blackBar: 1 }), 'black')).toBe(false);
  });

  it('ignores borne-off checkers', () => {
    expect(allCheckersHome(makeBoard({ white: { 3: 5 }, whiteOff: 10 }), 'white')).toBe(true);
    expect(allCheckersHome(makeBoard({ black: { 21: 5 }, blackOff: 10 }), 'black')).toBe(true);
  });

  it('is not confused by the opponent sitting outside the player s home', () => {
    const b = makeBoard({ white: { 2: 5 }, black: { 13: 5 }, blackBar: 2 });
    expect(allCheckersHome(b, 'white')).toBe(true);
    expect(allCheckersHome(b, 'black')).toBe(false);
  });
});

describe('pipCount', () => {
  it('is 167 for both sides in the opening position', () => {
    const b = initialBoard();
    expect(pipCount(b, 'white')).toBe(167);
    expect(pipCount(b, 'black')).toBe(167);
  });

  it('drops by the pips played after a known white opening', () => {
    // The 6-2 "split": 24/18, 13/11 costs white 8 pips and leaves black untouched.
    const after = applyMoveToBoard(
      applyMoveToBoard(initialBoard(), 'white', { from: 24, to: 18, die: 6, hit: false }),
      'white',
      { from: 13, to: 11, die: 2, hit: false },
    );
    expect(pipCount(after, 'white')).toBe(159);
    expect(pipCount(after, 'black')).toBe(167);
  });

  it('drops by the pips played after a known black opening', () => {
    const after = applyMoveToBoard(
      applyMoveToBoard(initialBoard(), 'black', { from: 1, to: 7, die: 6, hit: false }),
      'black',
      { from: 12, to: 14, die: 2, hit: false },
    );
    expect(pipCount(after, 'black')).toBe(159);
    expect(pipCount(after, 'white')).toBe(167);
  });

  it('charges 25 pips for a checker on the bar', () => {
    expect(pipCount(makeBoard({ white: { 1: 1 }, whiteBar: 1 }), 'white')).toBe(26);
    expect(pipCount(makeBoard({ black: { 24: 1 }, blackBar: 1 }), 'black')).toBe(26);
  });

  it('charges nothing for borne-off checkers', () => {
    expect(pipCount(makeBoard({ white: { 2: 1 }, whiteOff: 14 }), 'white')).toBe(2);
    expect(pipCount(makeBoard({ black: { 23: 1 }, blackOff: 14 }), 'black')).toBe(2);
    expect(pipCount(makeBoard({ whiteOff: 15 }), 'white')).toBe(0);
  });
});

describe('cloneBoard and boardKey', () => {
  it('clone is a distinct but equal object', () => {
    const b = initialBoard();
    const c = cloneBoard(b);
    expect(c).not.toBe(b);
    expect(c).toEqual(b);
    expect(c.points).not.toBe(b.points);
  });

  it('boardKey is equal for equal positions and different for different ones', () => {
    expect(boardKey(initialBoard())).toBe(boardKey(initialBoard()));
    expect(boardKey(initialBoard())).toBe(boardKey(cloneBoard(initialBoard())));

    const moved = applyMoveToBoard(initialBoard(), 'white', {
      from: 24,
      to: 18,
      die: 6,
      hit: false,
    });
    expect(boardKey(moved)).not.toBe(boardKey(initialBoard()));
  });

  it('boardKey distinguishes bar and off counts', () => {
    const base = makeBoard({ white: { 6: 1 } });
    expect(boardKey(makeBoard({ white: { 6: 1 }, whiteBar: 1 }))).not.toBe(boardKey(base));
    expect(boardKey(makeBoard({ white: { 6: 1 }, whiteOff: 1 }))).not.toBe(boardKey(base));
    expect(boardKey(makeBoard({ white: { 6: 1 }, blackBar: 1 }))).not.toBe(boardKey(base));
  });

  it('boardKey distinguishes colour on the same point', () => {
    expect(boardKey(makeBoard({ white: { 6: 2 } }))).not.toBe(boardKey(makeBoard({ black: { 6: 2 } })));
  });
});

describe('applyMoveToBoard', () => {
  it('moves one checker and leaves the source board untouched', () => {
    const before = makeBoard({ white: { 13: 2 } });
    const after = applyMoveToBoard(before, 'white', { from: 13, to: 8, die: 5, hit: false });

    expect(pointAt(after, 13)).toEqual({ color: 'white', count: 1 });
    expect(pointAt(after, 8)).toEqual({ color: 'white', count: 1 });
    // purity: the input board must be unchanged
    expect(pointAt(before, 13)).toEqual({ color: 'white', count: 2 });
    expect(pointAt(before, 8)).toEqual({ color: null, count: 0 });
  });

  it('empties a point completely when the last checker leaves', () => {
    const after = applyMoveToBoard(makeBoard({ white: { 13: 1 } }), 'white', {
      from: 13,
      to: 8,
      die: 5,
      hit: false,
    });
    expect(pointAt(after, 13)).toEqual({ color: null, count: 0 });
  });

  it('moves black in the opposite direction', () => {
    const after = applyMoveToBoard(makeBoard({ black: { 12: 2 } }), 'black', {
      from: 12,
      to: 17,
      die: 5,
      hit: false,
    });
    expect(pointAt(after, 12)).toEqual({ color: 'black', count: 1 });
    expect(pointAt(after, 17)).toEqual({ color: 'black', count: 1 });
  });

  it('decrements the bar when entering', () => {
    const after = applyMoveToBoard(makeBoard({ whiteBar: 2 }), 'white', {
      from: 'bar',
      to: 22,
      die: 3,
      hit: false,
    });
    expect(after.bar.white).toBe(1);
    expect(pointAt(after, 22)).toEqual({ color: 'white', count: 1 });
  });

  it('increments the off counter when bearing off', () => {
    const after = applyMoveToBoard(makeBoard({ white: { 3: 1 }, whiteOff: 14 }), 'white', {
      from: 3,
      to: 'off',
      die: 3,
      hit: false,
    });
    expect(after.off.white).toBe(15);
    expect(pointAt(after, 3)).toEqual({ color: null, count: 0 });

    const blackAfter = applyMoveToBoard(makeBoard({ black: { 22: 1 }, blackOff: 14 }), 'black', {
      from: 22,
      to: 'off',
      die: 3,
      hit: false,
    });
    expect(blackAfter.off.black).toBe(15);
    expect(pointAt(blackAfter, 22)).toEqual({ color: null, count: 0 });
  });

  it('sends exactly one checker to the BLACK bar when white hits', () => {
    const before = makeBoard({ white: { 13: 1 }, black: { 8: 1 } });
    const after = applyMoveToBoard(before, 'white', { from: 13, to: 8, die: 5, hit: true });

    expect(after.bar.black).toBe(1);
    expect(after.bar.white).toBe(0);
    expect(pointAt(after, 8)).toEqual({ color: 'white', count: 1 });
    expect(totalCheckers(after, 'white')).toBe(1);
    expect(totalCheckers(after, 'black')).toBe(1);
  });

  it('sends exactly one checker to the WHITE bar when black hits', () => {
    const before = makeBoard({ black: { 12: 1 }, white: { 17: 1 } });
    const after = applyMoveToBoard(before, 'black', { from: 12, to: 17, die: 5, hit: true });

    expect(after.bar.white).toBe(1);
    expect(after.bar.black).toBe(0);
    expect(pointAt(after, 17)).toEqual({ color: 'black', count: 1 });
  });

  it('adds to an existing bar count rather than overwriting it', () => {
    const before = makeBoard({ white: { 13: 1 }, black: { 8: 1 }, blackBar: 2 });
    const after = applyMoveToBoard(before, 'white', { from: 13, to: 8, die: 5, hit: true });
    expect(after.bar.black).toBe(3);
  });

  it('stacks onto a point already held by the mover', () => {
    const after = applyMoveToBoard(makeBoard({ white: { 13: 1, 8: 3 } }), 'white', {
      from: 13,
      to: 8,
      die: 5,
      hit: false,
    });
    expect(pointAt(after, 8)).toEqual({ color: 'white', count: 4 });
  });

  it('conserves 15 checkers a side across a hit from the bar', () => {
    const before = makeBoard({
      white: { 6: 14 },
      whiteBar: 1,
      black: { 19: 14, 22: 1 },
    });
    const after = applyMoveToBoard(before, 'white', { from: 'bar', to: 22, die: 3, hit: true });
    expect(totalCheckers(after, 'white')).toBe(15);
    expect(totalCheckers(after, 'black')).toBe(15);
    expect(after.bar.white).toBe(0);
    expect(after.bar.black).toBe(1);
  });
});

describe('winTypeFor', () => {
  it('is single when the loser has borne off at least one checker', () => {
    const b = makeBoard({
      whiteOff: 15,
      black: { 19: 5, 20: 5, 21: 4 },
      blackOff: 1,
    });
    expect(winTypeFor(b, 'white')).toBe('single');
  });

  it('is single even if the loser is on the bar, provided they have borne one off', () => {
    const b = makeBoard({
      whiteOff: 15,
      black: { 19: 5, 20: 5, 21: 3 },
      blackBar: 1,
      blackOff: 1,
    });
    expect(winTypeFor(b, 'white')).toBe('single');
  });

  it('is gammon when the loser has borne off zero but is clear of danger', () => {
    // Black holds only its own outfield/home: nothing on the bar, nothing in 1..6.
    const b = makeBoard({ whiteOff: 15, black: { 19: 5, 20: 5, 21: 5 } });
    expect(winTypeFor(b, 'white')).toBe('gammon');
  });

  it('is backgammon when the loser has zero off and a checker on the bar', () => {
    const b = makeBoard({ whiteOff: 15, black: { 19: 5, 20: 5, 21: 4 }, blackBar: 1 });
    expect(winTypeFor(b, 'white')).toBe('backgammon');
  });

  it("is backgammon when the loser has zero off and a checker in the WINNER's home", () => {
    // Point 3 is inside white's home board (1..6).
    const b = makeBoard({ whiteOff: 15, black: { 19: 5, 20: 5, 21: 4, 3: 1 } });
    expect(winTypeFor(b, 'white')).toBe('backgammon');
  });

  it("is only gammon when the loser sits in its OWN home, not the winner's", () => {
    // Point 20 is black's home, not white's: not a backgammon.
    const b = makeBoard({ whiteOff: 15, black: { 20: 15 } });
    expect(winTypeFor(b, 'white')).toBe('gammon');
  });

  it('mirrors for a black winner', () => {
    const single = makeBoard({ blackOff: 15, white: { 6: 5, 5: 5, 4: 4 }, whiteOff: 1 });
    expect(winTypeFor(single, 'black')).toBe('single');

    const gammon = makeBoard({ blackOff: 15, white: { 6: 5, 5: 5, 4: 5 } });
    expect(winTypeFor(gammon, 'black')).toBe('gammon');

    const bgBar = makeBoard({ blackOff: 15, white: { 6: 5, 5: 5, 4: 4 }, whiteBar: 1 });
    expect(winTypeFor(bgBar, 'black')).toBe('backgammon');

    // Point 22 is inside black's home board (19..24).
    const bgHome = makeBoard({ blackOff: 15, white: { 6: 5, 5: 5, 4: 4, 22: 1 } });
    expect(winTypeFor(bgHome, 'black')).toBe('backgammon');
  });
});
