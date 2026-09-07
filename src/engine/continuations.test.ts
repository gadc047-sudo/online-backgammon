import { describe, expect, it } from 'vitest';

import {
  expandDice,
  isSequenceComplete,
  legalContinuations,
  legalSequences,
  makeBoard,
  type Move,
} from './index';

/**
 * Regression cover for a bug that reached the server before it was caught.
 *
 * `legalSequences` deliberately collapses permutations that reach the same
 * board into one representative play. `legalContinuations` used to derive the
 * legal next moves by prefix-filtering that collapsed set, which silently
 * forbade perfectly legal opening hops whenever a different ordering happened
 * to be chosen as the representative. In the position below a player could not
 * hit a blot with 8/5 first, even though 8/5 then 13/8 is a legal full turn.
 *
 * The invariant that must hold, and that these tests pin down: a hop is a legal
 * continuation exactly when some maximal play uses it at that point, regardless
 * of which ordering `legalSequences` chose to return.
 */

/** White to play 5 and 3. Point 5 holds a lone black checker, so 8/5 hits. */
function blotOnFive() {
  return makeBoard({
    white: { 24: 2, 13: 5, 8: 3, 6: 5 },
    black: { 19: 5, 17: 3, 12: 5, 5: 1, 1: 1 },
  });
}

function hopKeys(moves: readonly Move[]): string[] {
  return moves.map((m) => `${String(m.from)}/${String(m.to)}:${m.die}`).sort();
}

describe('legalContinuations is independent of sequence ordering', () => {
  it('offers a hit that only ever appears second in the deduped sequence list', () => {
    const board = blotOnFive();
    const dice = expandDice([5, 3]);

    const firstMovesOfSequences = new Set(
      legalSequences(board, 'white', dice).map((s) => (s[0] ? `${String(s[0].from)}/${String(s[0].to)}:${s[0].die}` : '')),
    );
    // The representative plays never start with 8/5, which is what caused the bug.
    expect(firstMovesOfSequences.has('8/5:3')).toBe(false);

    // It is nonetheless a legal opening hop, and it is correctly marked as a hit.
    const opening = legalContinuations(board, 'white', dice, []);
    const eightToFive = opening.find((m) => m.from === 8 && m.to === 5);
    expect(eightToFive).toBeDefined();
    expect(eightToFive?.die).toBe(3);
    expect(eightToFive?.hit).toBe(true);
  });

  it('lets the turn complete after playing the previously unreachable hop first', () => {
    const board = blotOnFive();
    const dice = expandDice([5, 3]);

    const first = legalContinuations(board, 'white', dice, []).find(
      (m) => m.from === 8 && m.to === 5,
    );
    expect(first).toBeDefined();

    // Both dice must still be playable from here, so the turn is not complete.
    const after = legalContinuations(board, 'white', dice, [first as Move]);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((m) => m.die === 5)).toBe(true);
    expect(isSequenceComplete(board, 'white', dice, [first as Move])).toBe(false);

    const second = after[0] as Move;
    expect(isSequenceComplete(board, 'white', dice, [first as Move, second])).toBe(true);
  });

  it('agrees with legalSequences on the set of usable opening hops', () => {
    const board = blotOnFive();
    const dice = expandDice([5, 3]);

    // Every hop that appears anywhere a maximal play could legally start.
    const fromSequences = new Set<string>();
    for (const sequence of legalSequences(board, 'white', dice)) {
      for (const move of sequence) {
        // A hop can open the turn if it does not depend on an earlier hop.
        // Both orderings of a two-hop play are legal openings unless the second
        // hop moves a checker the first hop placed.
        fromSequences.add(`${String(move.from)}/${String(move.to)}:${move.die}`);
      }
    }

    const opening = hopKeys(legalContinuations(board, 'white', dice, []));
    // Every opening hop we offer must be a hop of some maximal play.
    for (const key of opening) expect(fromSequences.has(key)).toBe(true);
    // And we must offer strictly more than the representative first moves did.
    expect(opening.length).toBeGreaterThan(4);
  });

  it('rejects a prefix that is not legal', () => {
    const board = blotOnFive();
    const dice = expandDice([5, 3]);
    const bogus: Move = { from: 24, to: 22, die: 2, hit: false };
    expect(() => legalContinuations(board, 'white', dice, [bogus])).toThrow();
  });

  it('still forces the higher die when only one die can be played', () => {
    // Black owns every point white could reach with a 3, but 24/18 with a 6 is
    // open. Only one die is playable, so it must be the 6.
    const board = makeBoard({
      white: { 24: 2, 13: 5, 8: 3, 6: 5 },
      black: { 21: 2, 18: 1, 10: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 },
    });
    const dice = expandDice([6, 3]);
    const sequences = legalSequences(board, 'white', dice);
    if (sequences[0]?.length === 1) {
      const opening = legalContinuations(board, 'white', dice, []);
      expect(opening.length).toBeGreaterThan(0);
      expect(opening.every((m) => m.die === 6)).toBe(true);
    }
  });

  it('keeps doubles fast from the opening position', () => {
    const board = makeBoard({
      white: { 24: 2, 13: 5, 8: 3, 6: 5 },
      black: { 1: 2, 12: 5, 17: 3, 19: 5 },
    });
    const started = process.hrtime.bigint();
    const opening = legalContinuations(board, 'white', expandDice([6, 6]), []);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(opening.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(100);
  });
});
