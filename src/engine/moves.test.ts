/**
 * moves.ts — legal move-sequence generation. The heart of the engine.
 *
 * Derived only from src/engine/CONTRACT.md + src/engine/types.ts.
 *
 * Every fixture is minimal on purpose: a handful of checkers so the complete
 * set of legal plays can be enumerated by hand and asserted exactly. Each one
 * is commented with the position it represents and the rule it probes.
 *
 * Geometry: white 24 -> 1 (home 1..6, entry 25 - die);
 *           black 1 -> 24 (home 19..24, entry die).
 */

import {
  IllegalMoveError,
  expandDice,
  isSequenceComplete,
  legalContinuations,
  legalSequences,
  makeBoard,
} from './index';
import type { DieValue, Move } from './index';

function moveKey(m: Move): string {
  return `${String(m.from)}>${String(m.to)}/${m.die}${m.hit ? '!' : ''}`;
}

/** Stable, order-insensitive view of the returned play list. */
function playKeys(seqs: readonly (readonly Move[])[]): string[] {
  return seqs.map((s) => s.map(moveKey).join(' ')).sort();
}

function keysOf(moves: readonly Move[]): string[] {
  return moves.map(moveKey).sort();
}

describe('expandDice', () => {
  it('returns the two dice for a non-double', () => {
    expect(expandDice([6, 3])).toEqual([6, 3]);
    expect(expandDice([1, 2])).toEqual([1, 2]);
  });

  it('returns four copies for doubles', () => {
    expect(expandDice([4, 4])).toEqual([4, 4, 4, 4]);
    expect(expandDice([1, 1])).toEqual([1, 1, 1, 1]);
    expect(expandDice([6, 6])).toHaveLength(4);
  });
});

describe('legalSequences: maximise dice used', () => {
  it('white must choose the order that plays BOTH dice', () => {
    // White has a single checker on 24. Black has made point 18.
    // Playing 6 first is dead (24/18 is blocked); playing 3 first opens 21/15.
    const board = makeBoard({ white: { 24: 1 }, black: { 18: 2 } });
    const seqs = legalSequences(board, 'white', [6, 3]);

    for (const s of seqs) expect(s).toHaveLength(2);
    expect(seqs).toEqual([
      [
        { from: 24, to: 21, die: 3, hit: false },
        { from: 21, to: 15, die: 6, hit: false },
      ],
    ]);
  });

  it('black must choose the order that plays BOTH dice', () => {
    // Mirror image: black checker on 1, white has made point 7.
    const board = makeBoard({ black: { 1: 1 }, white: { 7: 2 } });
    const seqs = legalSequences(board, 'black', [6, 3]);

    for (const s of seqs) expect(s).toHaveLength(2);
    expect(seqs).toEqual([
      [
        { from: 1, to: 4, die: 3, hit: false },
        { from: 4, to: 10, die: 6, hit: false },
      ],
    ]);
  });

  it('never returns a short sequence alongside a longer one', () => {
    // Same as above: the length-1 play 24/21 exists but must be discarded
    // because a length-2 play exists.
    const board = makeBoard({ white: { 24: 1 }, black: { 18: 2 } });
    const seqs = legalSequences(board, 'white', [6, 3]);
    const lengths = new Set(seqs.map((s) => s.length));
    expect([...lengths]).toEqual([2]);
  });
});

describe('legalSequences: higher-die preference', () => {
  it('keeps only the higher die when both are individually playable but not together (white)', () => {
    // White checker on 13; black owns point 6.
    //   5 first: 13/8, then 8/6 is blocked.
    //   2 first: 13/11, then 11/6 is blocked.
    // L = 1, so rule 4 discards the die-2 play.
    const board = makeBoard({ white: { 13: 1 }, black: { 6: 2 } });
    const seqs = legalSequences(board, 'white', [5, 2]);

    expect(seqs).toEqual([[{ from: 13, to: 8, die: 5, hit: false }]]);
  });

  it('keeps only the higher die when both are individually playable but not together (black)', () => {
    // Mirror: black checker on 12; white owns point 19.
    const board = makeBoard({ black: { 12: 1 }, white: { 19: 2 } });
    const seqs = legalSequences(board, 'black', [5, 2]);

    expect(seqs).toEqual([[{ from: 12, to: 17, die: 5, hit: false }]]);
  });

  it('returns the higher die when only the higher die has any legal move', () => {
    // White on 13; black owns 12 (kills the 1) and 6 (kills the follow-up).
    const board = makeBoard({ white: { 13: 1 }, black: { 12: 2, 6: 2 } });
    const seqs = legalSequences(board, 'white', [6, 1]);

    expect(seqs).toEqual([[{ from: 13, to: 7, die: 6, hit: false }]]);
  });

  it('returns the LOWER die when the higher die has no legal move at all', () => {
    // Rule 4 only prefers the higher die when a higher-die play exists.
    // White on 13; black owns 7 (kills the 6) and 5 (kills the follow-up).
    const board = makeBoard({ white: { 13: 1 }, black: { 7: 2, 5: 2 } });
    const seqs = legalSequences(board, 'white', [6, 2]);

    expect(seqs).toEqual([[{ from: 13, to: 11, die: 2, hit: false }]]);
  });

  it('returns the LOWER die when the higher die has no legal move at all (black)', () => {
    const board = makeBoard({ black: { 12: 1 }, white: { 18: 2, 20: 2 } });
    const seqs = legalSequences(board, 'black', [6, 2]);

    expect(seqs).toEqual([[{ from: 12, to: 14, die: 2, hit: false }]]);
  });
});

describe('legalSequences: no legal play', () => {
  it('returns one empty sequence when white is closed out on the bar', () => {
    // Black has made all six of its home points, which are white's entry points.
    const board = makeBoard({
      whiteBar: 1,
      white: { 13: 2 },
      black: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 },
    });
    expect(legalSequences(board, 'white', [1, 6])).toEqual([[]]);
    expect(legalSequences(board, 'white', expandDice([3, 3]))).toEqual([[]]);
  });

  it('returns one empty sequence when black is closed out on the bar', () => {
    const board = makeBoard({
      blackBar: 1,
      black: { 12: 2 },
      white: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 },
    });
    expect(legalSequences(board, 'black', [1, 6])).toEqual([[]]);
  });

  it('returns one empty sequence when every landing point is blocked', () => {
    // White on 13 with both 7 (die 6) and 11 (die 2) made by black.
    const board = makeBoard({ white: { 13: 1 }, black: { 7: 2, 11: 2 } });
    expect(legalSequences(board, 'white', [6, 2])).toEqual([[]]);
  });

  it('never returns an empty list', () => {
    const board = makeBoard({ white: { 13: 1 }, black: { 7: 2, 11: 2 } });
    expect(legalSequences(board, 'white', [6, 2]).length).toBeGreaterThan(0);
  });
});

describe('legalSequences: bar re-entry', () => {
  it('forces every play to start from the bar (white)', () => {
    // White has one on the bar plus checkers on 13 and 8. Black owns 21,
    // so the only entry is 25 - 3 = 22 with the 3.
    const board = makeBoard({ whiteBar: 1, white: { 13: 1, 8: 1 }, black: { 21: 2 } });
    const seqs = legalSequences(board, 'white', [3, 4]);

    expect(seqs).toHaveLength(3);
    for (const s of seqs) {
      expect(s).toHaveLength(2);
      expect(s[0]).toEqual({ from: 'bar', to: 22, die: 3, hit: false });
    }
    expect(playKeys(seqs)).toEqual(
      [
        'bar>22/3 22>18/4',
        'bar>22/3 13>9/4',
        'bar>22/3 8>4/4',
      ].sort(),
    );
  });

  it('forces every play to start from the bar (black)', () => {
    // Mirror: black on the bar, white owns point 4, so entry is point 3 with the 3.
    const board = makeBoard({ blackBar: 1, black: { 12: 1, 17: 1 }, white: { 4: 2 } });
    const seqs = legalSequences(board, 'black', [3, 4]);

    expect(seqs).toHaveLength(3);
    for (const s of seqs) {
      expect(s).toHaveLength(2);
      expect(s[0]).toEqual({ from: 'bar', to: 3, die: 3, hit: false });
    }
    expect(playKeys(seqs)).toEqual(
      [
        'bar>3/3 3>7/4',
        'bar>3/3 12>16/4',
        'bar>3/3 17>21/4',
      ].sort(),
    );
  });

  it('enters with a hit onto a blot (white)', () => {
    // Black has a blot on 22 (white's 3-entry) and a made point on 21 (the 4-entry).
    const board = makeBoard({ whiteBar: 1, black: { 22: 1, 21: 2 } });
    const seqs = legalSequences(board, 'white', [3, 4]);

    expect(seqs).toEqual([
      [
        { from: 'bar', to: 22, die: 3, hit: true },
        { from: 22, to: 18, die: 4, hit: false },
      ],
    ]);
  });

  it('enters with a hit onto a blot (black)', () => {
    const board = makeBoard({ blackBar: 1, white: { 3: 1, 4: 2 } });
    const seqs = legalSequences(board, 'black', [3, 4]);

    expect(seqs).toEqual([
      [
        { from: 'bar', to: 3, die: 3, hit: true },
        { from: 3, to: 7, die: 4, hit: false },
      ],
    ]);
  });

  it('two on the bar with only one usable entry die yields a single hop (white)', () => {
    // Both entries would be needed, but 21 (the 4-entry) is made by black.
    // The second checker is stuck on the bar, so nothing else may move either.
    const board = makeBoard({ whiteBar: 2, white: { 13: 2 }, black: { 21: 2 } });
    const seqs = legalSequences(board, 'white', [3, 4]);

    expect(seqs).toEqual([[{ from: 'bar', to: 22, die: 3, hit: false }]]);
  });

  it('two on the bar with only one usable entry die yields a single hop (black)', () => {
    const board = makeBoard({ blackBar: 2, black: { 12: 2 }, white: { 4: 2 } });
    const seqs = legalSequences(board, 'black', [3, 4]);

    expect(seqs).toEqual([[{ from: 'bar', to: 3, die: 3, hit: false }]]);
  });

  it('enters both checkers before moving anything else', () => {
    // Two on the bar, both entries open (22 with the 3, 21 with the 4).
    // Both dice are consumed by entries; no other checker may move.
    const board = makeBoard({ whiteBar: 2, white: { 13: 1 } });
    const seqs = legalSequences(board, 'white', [3, 4]);

    expect(seqs).toHaveLength(1);
    expect(playKeys(seqs)).toEqual(['bar>22/3 bar>21/4'].sort());
  });
});

describe('legalSequences: hitting', () => {
  it('marks a lone opposing checker as a hit (white)', () => {
    // Black blot on 8. White on 13 can hit it with the 5 or slide past with the 3.
    const board = makeBoard({ white: { 13: 1 }, black: { 8: 1 } });
    const seqs = legalSequences(board, 'white', [5, 3]);

    expect(playKeys(seqs)).toEqual(['13>8/5! 8>5/3', '13>10/3 10>5/5'].sort());
    const hitting = seqs.find((s) => s.some((m) => m.hit));
    expect(hitting).toBeDefined();
    expect(hitting?.[0]).toEqual({ from: 13, to: 8, die: 5, hit: true });
  });

  it('marks a lone opposing checker as a hit (black)', () => {
    const board = makeBoard({ black: { 12: 1 }, white: { 17: 1 } });
    const seqs = legalSequences(board, 'black', [5, 3]);

    expect(playKeys(seqs)).toEqual(['12>17/5! 17>20/3', '12>15/3 15>20/5'].sort());
  });

  it('treats a point with two or more opposing checkers as blocked, never a hit', () => {
    // Same shape as above but black has MADE point 8 rather than left a blot.
    const board = makeBoard({ white: { 13: 1 }, black: { 8: 2 } });
    const seqs = legalSequences(board, 'white', [5, 3]);

    expect(seqs).toEqual([
      [
        { from: 13, to: 10, die: 3, hit: false },
        { from: 10, to: 5, die: 5, hit: false },
      ],
    ]);
    for (const s of seqs) for (const m of s) expect(m.to).not.toBe(8);
  });

  it('never marks landing on an own-colour stack as a hit', () => {
    const board = makeBoard({ white: { 13: 1, 8: 3 } });
    const seqs = legalSequences(board, 'white', [5, 5, 5, 5]);
    for (const s of seqs) for (const m of s) expect(m.hit).toBe(false);
  });

  it('can hit twice in one doubles turn', () => {
    // White checker on 12; black blots on 10 and 8. Doubles 2 walks over both.
    const board = makeBoard({ white: { 12: 1 }, black: { 10: 1, 8: 1 } });
    const seqs = legalSequences(board, 'white', expandDice([2, 2]));

    expect(seqs).toEqual([
      [
        { from: 12, to: 10, die: 2, hit: true },
        { from: 10, to: 8, die: 2, hit: true },
        { from: 8, to: 6, die: 2, hit: false },
        { from: 6, to: 4, die: 2, hit: false },
      ],
    ]);
  });
});

describe('legalSequences: doubles', () => {
  it('plays four hops with a single checker', () => {
    const board = makeBoard({ white: { 13: 1 } });
    const seqs = legalSequences(board, 'white', expandDice([2, 2]));

    expect(seqs).toEqual([
      [
        { from: 13, to: 11, die: 2, hit: false },
        { from: 11, to: 9, die: 2, hit: false },
        { from: 9, to: 7, die: 2, hit: false },
        { from: 7, to: 5, die: 2, hit: false },
      ],
    ]);
  });

  it('plays four hops with a single checker (black)', () => {
    const board = makeBoard({ black: { 12: 1 } });
    const seqs = legalSequences(board, 'black', expandDice([2, 2]));

    expect(seqs).toEqual([
      [
        { from: 12, to: 14, die: 2, hit: false },
        { from: 14, to: 16, die: 2, hit: false },
        { from: 16, to: 18, die: 2, hit: false },
        { from: 18, to: 20, die: 2, hit: false },
      ],
    ]);
  });

  it('plays fewer than four hops when the run is blocked', () => {
    // White on 5, black owns point 2: 5/4, 4/3, then 3/2 is blocked. L = 2.
    const board = makeBoard({ white: { 5: 1 }, black: { 2: 2 } });
    const seqs = legalSequences(board, 'white', expandDice([1, 1]));

    expect(seqs).toEqual([
      [
        { from: 5, to: 4, die: 1, hit: false },
        { from: 4, to: 3, die: 1, hit: false },
      ],
    ]);
  });
});

describe('legalSequences: bearing off', () => {
  it('bears off with an exact die (white)', () => {
    // Two checkers on white's 6-point, thirteen already off, double 6s.
    const board = makeBoard({ white: { 6: 2 }, whiteOff: 13 });
    const seqs = legalSequences(board, 'white', expandDice([6, 6]));

    expect(seqs).toEqual([
      [
        { from: 6, to: 'off', die: 6, hit: false },
        { from: 6, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('bears off with an exact die (black)', () => {
    // Black's 19-point is 6 pips from off.
    const board = makeBoard({ black: { 19: 2 }, blackOff: 13 });
    const seqs = legalSequences(board, 'black', expandDice([6, 6]));

    expect(seqs).toEqual([
      [
        { from: 19, to: 'off', die: 6, hit: false },
        { from: 19, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('allows an overshoot when no checker sits farther out (white)', () => {
    // Checkers on the 5-point only; a 6 bears them off because 5 is the farthest.
    const board = makeBoard({ white: { 5: 2 }, whiteOff: 13 });
    const seqs = legalSequences(board, 'white', expandDice([6, 6]));

    expect(seqs).toEqual([
      [
        { from: 5, to: 'off', die: 6, hit: false },
        { from: 5, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('allows an overshoot when no checker sits farther out (black)', () => {
    // Black's 20-point is 5 pips from off.
    const board = makeBoard({ black: { 20: 2 }, blackOff: 13 });
    const seqs = legalSequences(board, 'black', expandDice([6, 6]));

    expect(seqs).toEqual([
      [
        { from: 20, to: 'off', die: 6, hit: false },
        { from: 20, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('forbids an overshoot while a farther checker exists, then allows it (white)', () => {
    // White: two on the 6-point, one on the 2-point, double 6s.
    // The 2-point checker may NOT come off while the 6-point checkers remain.
    const board = makeBoard({ white: { 6: 2, 2: 1 }, whiteOff: 12 });

    // Before anything is played, 2/off is illegal: the only legal 6 is 6/off.
    expect(keysOf(legalContinuations(board, 'white', expandDice([6, 6]), []))).toEqual([
      "6>off/6",
    ]);

    const seqs = legalSequences(board, 'white', expandDice([6, 6]));
    expect(seqs).toEqual([
      [
        { from: 6, to: 'off', die: 6, hit: false },
        { from: 6, to: 'off', die: 6, hit: false },
        { from: 2, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('forbids an overshoot while a farther checker exists, then allows it (black)', () => {
    // Mirror: black two on the 19-point (6 pips), one on the 23-point (2 pips).
    const board = makeBoard({ black: { 19: 2, 23: 1 }, blackOff: 12 });

    expect(keysOf(legalContinuations(board, 'black', expandDice([6, 6]), []))).toEqual([
      '19>off/6',
    ]);

    const seqs = legalSequences(board, 'black', expandDice([6, 6]));
    expect(seqs).toEqual([
      [
        { from: 19, to: 'off', die: 6, hit: false },
        { from: 19, to: 'off', die: 6, hit: false },
        { from: 23, to: 'off', die: 6, hit: false },
      ],
    ]);
  });

  it('never bears off while a checker is on the bar', () => {
    // White has 14 checkers home but one on the bar; entry must come first and
    // the entered checker then sits outside home, so no bear-off is legal.
    const board = makeBoard({ white: { 1: 2, 2: 1 }, whiteBar: 1, whiteOff: 12 });
    const seqs = legalSequences(board, 'white', [1, 2]);

    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) {
      expect(s[0]?.from).toBe('bar');
      for (const m of s) expect(m.to).not.toBe('off');
    }
  });

  it('never bears off while a checker sits outside the home board', () => {
    // White has a checker on 8, outside the 1..6 home board.
    const board = makeBoard({ white: { 8: 1, 3: 1 }, whiteOff: 13 });
    const seqs = legalSequences(board, 'white', [3, 1]);

    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) {
      expect(s).toHaveLength(2);
      for (const m of s) expect(m.to).not.toBe('off');
    }
  });

  it('never bears off while a checker sits outside the home board (black)', () => {
    // Black on 17, outside the 19..24 home board.
    const board = makeBoard({ black: { 17: 1, 22: 1 }, blackOff: 13 });
    const seqs = legalSequences(board, 'black', [3, 1]);

    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) {
      expect(s).toHaveLength(2);
      for (const m of s) expect(m.to).not.toBe('off');
    }
  });

  it('a die smaller than the distance still moves the checker inside the home board', () => {
    // White single checker on the 6-point, fourteen off, roll 6-1.
    //   6/off with the 6 then nothing left  -> length 1
    //   6/5 with the 1 then 5/off with the 6 -> length 2, so this is the play.
    const board = makeBoard({ white: { 6: 1 }, whiteOff: 14 });
    const seqs = legalSequences(board, 'white', [6, 1]);

    expect(seqs).toEqual([
      [
        { from: 6, to: 5, die: 1, hit: false },
        { from: 5, to: 'off', die: 6, hit: false },
      ],
    ]);
  });
});

describe('legalSequences: deduping permutations', () => {
  it('collapses two orderings of the same two bear-offs into one play', () => {
    // White on the 6- and 2-points, roll 6-2.
    //   play A: 6/off and 2/off in either order  -> the SAME resulting board
    //   play B: 6/4 with the 2, then 4/off with the 6
    // Only two distinct plays may be returned.
    const board = makeBoard({ white: { 6: 1, 2: 1 }, whiteOff: 13 });
    const seqs = legalSequences(board, 'white', [6, 2]);

    expect(seqs).toHaveLength(2);
    for (const s of seqs) expect(s).toHaveLength(2);

    const bothOff = seqs.find((s) => s.every((m) => m.to === 'off'));
    expect(bothOff).toBeDefined();
    expect(keysOf(bothOff ?? [])).toEqual(['2>off/2', '6>off/6'].sort());
  });
});

describe('legalContinuations', () => {
  // Black blot on 8; white checker on 13; roll 5-3. Two distinct plays:
  //   13/8* 8/5   and   13/10 10/5
  const board = makeBoard({ white: { 13: 1 }, black: { 8: 1 } });
  const dice: DieValue[] = [5, 3];

  it('returns every distinct first move when nothing has been played', () => {
    expect(keysOf(legalContinuations(board, 'white', dice, []))).toEqual(
      ['13>8/5!', '13>10/3'].sort(),
    );
  });

  it('filters to the moves that follow the played prefix', () => {
    const played: Move[] = [{ from: 13, to: 8, die: 5, hit: true }];
    expect(legalContinuations(board, 'white', dice, played)).toEqual([
      { from: 8, to: 5, die: 3, hit: false },
    ]);
  });

  it('compares the prefix on from/to/die only, ignoring a wrong hit flag', () => {
    // A client that forgot to set hit: true must still get the right answer.
    const played: Move[] = [{ from: 13, to: 8, die: 5, hit: false }];
    expect(legalContinuations(board, 'white', dice, played)).toEqual([
      { from: 8, to: 5, die: 3, hit: false },
    ]);
  });

  it('returns an empty array once the turn is finished', () => {
    const played: Move[] = [
      { from: 13, to: 8, die: 5, hit: true },
      { from: 8, to: 5, die: 3, hit: false },
    ];
    expect(legalContinuations(board, 'white', dice, played)).toEqual([]);
  });

  it('throws IllegalMoveError when the prefix uses a die that was not rolled', () => {
    const played: Move[] = [{ from: 13, to: 9, die: 4, hit: false }];
    expect(() => legalContinuations(board, 'white', dice, played)).toThrow(IllegalMoveError);
  });

  it('throws IllegalMoveError when the prefix is not a prefix of any legal play', () => {
    // 13/11 would need a 2; and even the right dice in a losing order must throw.
    expect(() =>
      legalContinuations(board, 'white', dice, [{ from: 13, to: 11, die: 2, hit: false }]),
    ).toThrow(IllegalMoveError);
    expect(() =>
      legalContinuations(board, 'white', dice, [{ from: 8, to: 5, die: 3, hit: false }]),
    ).toThrow(IllegalMoveError);
  });

  it('throws IllegalMoveError when the prefix strands a die that could have been played', () => {
    // Must-play-both fixture: starting with the 6 is not the start of any legal play.
    const forced = makeBoard({ white: { 24: 1 }, black: { 18: 2 } });
    expect(() =>
      legalContinuations(forced, 'white', [6, 3], [{ from: 24, to: 18, die: 6, hit: false }]),
    ).toThrow(IllegalMoveError);
  });

  it('returns an empty array for a player with no legal move at all', () => {
    const closed = makeBoard({
      whiteBar: 1,
      black: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 },
    });
    expect(legalContinuations(closed, 'white', [1, 6], [])).toEqual([]);
  });
});

describe('isSequenceComplete', () => {
  const board = makeBoard({ white: { 13: 1 }, black: { 8: 1 } });
  const dice: DieValue[] = [5, 3];

  it('is false at the start of a turn with moves available', () => {
    expect(isSequenceComplete(board, 'white', dice, [])).toBe(false);
  });

  it('is false halfway through a two-hop play', () => {
    expect(
      isSequenceComplete(board, 'white', dice, [{ from: 13, to: 8, die: 5, hit: true }]),
    ).toBe(false);
  });

  it('is true once the maximal sequence has been played', () => {
    expect(
      isSequenceComplete(board, 'white', dice, [
        { from: 13, to: 8, die: 5, hit: true },
        { from: 8, to: 5, die: 3, hit: false },
      ]),
    ).toBe(true);
  });

  it('is true immediately for a player with no legal move', () => {
    const closed = makeBoard({
      whiteBar: 1,
      black: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 },
    });
    expect(isSequenceComplete(closed, 'white', [1, 6], [])).toBe(true);
  });
});

describe('legalSequences: performance', () => {
  it('handles worst-case doubles from the opening position quickly', () => {
    // Contract requires worst-case doubles to finish well under 100ms.
    const board = makeBoard({
      white: { 24: 2, 13: 5, 8: 3, 6: 5 },
      black: { 1: 2, 12: 5, 17: 3, 19: 5 },
    });
    const started = Date.now();
    const seqs = legalSequences(board, 'white', expandDice([1, 1]));
    const elapsed = Date.now() - started;

    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) expect(s).toHaveLength(4);
    expect(elapsed).toBeLessThan(100);
  });
});
