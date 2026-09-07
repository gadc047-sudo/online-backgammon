/**
 * strategy.ts - move and cube decisions built on top of evaluateBoard.
 *
 * `chooseSequence` is tested against its actual contract (never worse than any
 * legal alternative) rather than a hand-picked "expected" move, since the
 * weights in evaluate.ts are free to be retuned later without breaking this.
 */
import { describe, expect, it } from 'vitest';

import { applyMoveToBoard, createGame, legalSequences, makeBoard, pointAt } from '../../engine';
import type { DieValue, GameState, Move } from '../../engine';
import { evaluateBoard } from './evaluate';
import { chooseSequence, estimateWinChance, shouldAcceptDouble, shouldOfferDouble } from './strategy';

function gameWith(overrides: Partial<GameState>): GameState {
  return { ...createGame(), ...overrides };
}

describe('chooseSequence', () => {
  it('never returns a sequence worse than any other legal sequence', () => {
    const board = makeBoard({
      white: { 8: 2, 6: 3, 13: 5, 24: 2 },
      black: { 5: 1, 19: 5, 12: 3, 1: 2 },
    });
    const dice: DieValue[] = [3, 1];
    const candidates = legalSequences(board, 'white', dice);
    expect(candidates.length).toBeGreaterThan(1); // otherwise this test proves nothing

    const scoreOf = (sequence: Move[]): number => {
      let after = board;
      for (const move of sequence) after = applyMoveToBoard(after, 'white', move);
      return evaluateBoard(after, 'white');
    };

    const chosen = chooseSequence(board, 'white', dice);
    const chosenScore = scoreOf(chosen);
    for (const candidate of candidates) {
      expect(chosenScore).toBeGreaterThanOrEqual(scoreOf(candidate));
    }
  });

  it('returns the single legal sequence unchanged when there is no choice', () => {
    // Only one checker on the board: both dice must play it, in some order,
    // and every open landing is legal, so exactly one final position exists.
    const board = makeBoard({ white: { 24: 1 } });
    const dice: DieValue[] = [6, 5];
    const chosen = chooseSequence(board, 'white', dice);
    let after = board;
    for (const move of chosen) after = applyMoveToBoard(after, 'white', move);
    expect(pointAt(after, 24 - 6 - 5).color).toBe('white');
  });

  it('returns an empty sequence when no legal move exists', () => {
    // White has a checker on the bar and every entry point is blocked.
    const blockedEntry = makeBoard({
      whiteBar: 1,
      black: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 },
    });
    const chosen = chooseSequence(blockedEntry, 'white', [1, 2]);
    expect(chosen).toEqual([]);
  });
});

describe('estimateWinChance', () => {
  it('is exactly 0.5 when pip counts are level', () => {
    const board = makeBoard({ white: { 6: 2 }, black: { 19: 2 } }); // 12 pips each
    expect(estimateWinChance(board, 'white')).toBeCloseTo(0.5, 10);
  });

  it('rises with a bigger pip lead and falls with a bigger deficit', () => {
    const level = makeBoard({ white: { 6: 2 }, black: { 19: 2 } });
    const bigLead = makeBoard({ white: { 1: 2 }, black: { 2: 2 } }); // white 2, black 46
    const bigDeficit = makeBoard({ white: { 23: 2 }, black: { 22: 2 } }); // white 46, black 6

    expect(estimateWinChance(bigLead, 'white')).toBeGreaterThan(estimateWinChance(level, 'white'));
    expect(estimateWinChance(bigLead, 'white')).toBeGreaterThan(0.9);
    expect(estimateWinChance(bigDeficit, 'white')).toBeLessThan(0.1);
  });
});

describe('shouldOfferDouble', () => {
  function awaitingRoll(board: GameState['board']): GameState {
    return gameWith({ phase: 'awaiting-roll', turn: 'white', board, cube: { value: 1, owner: null } });
  }

  it('doubles a position comfortably inside the double window', () => {
    // White pip 10, black pip 27: lead 17, win chance ~0.80.
    const board = makeBoard({ white: { 5: 2 }, black: { 23: 1 }, blackBar: 1 });
    expect(shouldOfferDouble(awaitingRoll(board), 'white')).toBe(true);
  });

  it('does not double a roughly level position', () => {
    const board = makeBoard({ white: { 6: 2 }, black: { 19: 2 } }); // lead 0
    expect(shouldOfferDouble(awaitingRoll(board), 'white')).toBe(false);
  });

  it('does not double once the market has gone away', () => {
    const board = makeBoard({ white: { 1: 2 }, black: { 2: 2 } }); // lead 44, chance ~0.975
    expect(shouldOfferDouble(awaitingRoll(board), 'white')).toBe(false);
  });

  it('never doubles when canDouble is false, regardless of the position', () => {
    const board = makeBoard({ white: { 5: 2 }, black: { 23: 1 }, blackBar: 1 }); // a clear double
    const midTurn = gameWith({
      phase: 'moving',
      turn: 'white',
      board,
      roll: [3, 1],
      dice: [3, 1],
      turnStartBoard: board,
      cube: { value: 1, owner: null },
    });
    expect(shouldOfferDouble(midTurn, 'white')).toBe(false);
  });
});

describe('shouldAcceptDouble', () => {
  it('takes when the win chance is well above the take floor', () => {
    const board = makeBoard({ white: { 10: 2 }, black: { 9: 1 } });
    expect(shouldAcceptDouble(gameWith({ board }), 'white')).toBe(true);
  });

  it('passes when the win chance is well below the take floor', () => {
    const board = makeBoard({ white: { 23: 2 }, black: { 9: 1 } });
    expect(shouldAcceptDouble(gameWith({ board }), 'white')).toBe(false);
  });
});
