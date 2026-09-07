/**
 * nextAction.ts - "what should the computer do right now," driven purely off
 * the same snapshot-shaped data a human player's client would see.
 */
import { describe, expect, it } from 'vitest';

import { createGame, makeBoard } from '../../engine';
import type { GameState } from '../../engine';
import { nextComputerAction, type ComputerActionContext } from './nextAction';

function gameWith(overrides: Partial<GameState>): GameState {
  return { ...createGame(), ...overrides };
}

function ctxFor(game: GameState | null, overrides: Partial<ComputerActionContext> = {}): ComputerActionContext {
  return { status: 'playing', game, rematchRequestedBy: [], ...overrides };
}

describe('nextComputerAction - no game / game over', () => {
  it('does nothing when there is no game yet', () => {
    expect(nextComputerAction(ctxFor(null), 'black')).toBeNull();
  });

  it('requests a rematch once the room is over and it has not asked yet', () => {
    const game = gameWith({ phase: 'game-over', winner: 'white', winType: 'single', winReason: 'resign' });
    expect(nextComputerAction(ctxFor(game, { status: 'game-over' }), 'black')).toEqual({
      type: 'rematch',
    });
  });

  it('does nothing once it has already requested the rematch', () => {
    const game = gameWith({ phase: 'game-over', winner: 'white', winType: 'single', winReason: 'resign' });
    const ctx = ctxFor(game, { status: 'game-over', rematchRequestedBy: ['black'] });
    expect(nextComputerAction(ctx, 'black')).toBeNull();
  });
});

describe('nextComputerAction - opening roll', () => {
  it('waits for the human to roll first rather than racing them', () => {
    const game = createGame();
    expect(nextComputerAction(ctxFor(game), 'black')).toBeNull();
  });

  it('rolls once the human has rolled and it has not', () => {
    const game = gameWith({ phase: 'opening-roll', openingRolls: { white: 4 } });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({ type: 'openingRoll' });
  });

  it('waits once it has already rolled', () => {
    const game = gameWith({ phase: 'opening-roll', openingRolls: { black: 4 } });
    expect(nextComputerAction(ctxFor(game), 'black')).toBeNull();
  });
});

describe('nextComputerAction - awaiting roll', () => {
  it('does nothing when it is not the computer turn', () => {
    const game = gameWith({ phase: 'awaiting-roll', turn: 'white' });
    expect(nextComputerAction(ctxFor(game), 'black')).toBeNull();
  });

  it('rolls on a level position even though it could double', () => {
    const board = makeBoard({ white: { 6: 2 }, black: { 19: 2 } }); // pips level
    const game = gameWith({
      phase: 'awaiting-roll',
      turn: 'black',
      board,
      cube: { value: 1, owner: null },
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({ type: 'roll' });
  });

  it('offers a double on a position comfortably inside the window', () => {
    // Black pip 10, white pip 27 (black is well ahead as the mover here).
    const board = makeBoard({ black: { 20: 2 }, white: { 2: 1 }, whiteBar: 1 });
    const game = gameWith({
      phase: 'awaiting-roll',
      turn: 'black',
      board,
      cube: { value: 1, owner: null },
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({ type: 'offerDouble' });
  });

  it('rolls instead of doubling when it does not own the cube', () => {
    const board = makeBoard({ black: { 20: 2 }, white: { 2: 1 }, whiteBar: 1 });
    const game = gameWith({
      phase: 'awaiting-roll',
      turn: 'black',
      board,
      cube: { value: 2, owner: 'white' },
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({ type: 'roll' });
  });
});

describe('nextComputerAction - moving', () => {
  it('does nothing when it is not the computer turn', () => {
    const board = createGame().board;
    const game = gameWith({
      phase: 'moving',
      turn: 'white',
      board,
      roll: [3, 1],
      dice: [3, 1],
      turnStartBoard: board,
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toBeNull();
  });

  it('plays the next hop of its chosen sequence', () => {
    const board = makeBoard({ black: { 1: 2 }, white: { 24: 2 } });
    const game = gameWith({
      phase: 'moving',
      turn: 'black',
      board,
      roll: [3, 1],
      dice: [3, 1],
      turnStartBoard: board,
      movesPlayed: [],
    });
    const action = nextComputerAction(ctxFor(game), 'black');
    expect(action?.type).toBe('move');
  });

  it('ends the turn once both dice of its sequence are already played', () => {
    // A single checker on the board must play both dice on itself; after
    // both hops there is nothing left to play.
    const turnStartBoard = makeBoard({ black: { 1: 1 } });
    const game = gameWith({
      phase: 'moving',
      turn: 'black',
      board: makeBoard({ black: { 5: 1 } }),
      roll: [3, 1],
      dice: [3, 1],
      turnStartBoard,
      movesPlayed: [
        { from: 1, to: 4, die: 3, hit: false },
        { from: 4, to: 5, die: 1, hit: false },
      ],
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({ type: 'endTurn' });
  });
});

describe('nextComputerAction - cube offered', () => {
  it('does nothing when the offer is not to the computer', () => {
    const game = gameWith({ phase: 'cube-offered', turn: 'white', cubeOfferedBy: 'black' });
    expect(nextComputerAction(ctxFor(game), 'black')).toBeNull();
  });

  it('takes a double when its win chance is comfortably above the take floor', () => {
    // Black pip 20, white pip 16: black is slightly behind but well clear of
    // the take floor.
    const board = makeBoard({ black: { 5: 1 }, white: { 16: 1 } });
    const game = gameWith({
      phase: 'cube-offered',
      turn: 'black',
      cubeOfferedBy: 'white',
      board,
      cube: { value: 2, owner: 'white' },
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({
      type: 'respondToDouble',
      accept: true,
    });
  });

  it('passes a double when its win chance is well below the take floor', () => {
    const board = makeBoard({ black: { 4: 2 }, white: { 9: 1 } });
    const game = gameWith({
      phase: 'cube-offered',
      turn: 'black',
      cubeOfferedBy: 'white',
      board,
      cube: { value: 2, owner: 'white' },
    });
    expect(nextComputerAction(ctxFor(game), 'black')).toEqual({
      type: 'respondToDouble',
      accept: false,
    });
  });
});
