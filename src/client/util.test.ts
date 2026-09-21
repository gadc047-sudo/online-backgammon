/**
 * `diceFaces` + `rollSummary` are the whole of the client's dice presentation
 * logic, and they are pure, so they get tested here rather than through a DOM.
 */

import { describe, expect, it } from 'vitest';

import { applyMove, applyRoll, createGame, legalMovesNow } from '../engine/game';
import type { DieValue, GameState, Move, Player } from '../engine/types';
import type { RoomSnapshot, Seat } from '../shared/protocol';
import { diceFaces, rollSummary, viewerOf, viewerSeatOf } from './util';

/** A game sat in `moving` with `roll` on the board, white to play. */
function rolled(roll: readonly [DieValue, DieValue]): GameState {
  const base = createGame();
  const ready: GameState = { ...base, phase: 'awaiting-roll', turn: 'white' };
  return applyRoll(ready, roll);
}

/** Play `count` legal moves, whatever they happen to be. */
function playSome(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const move: Move | undefined = legalMovesNow(next)[0];
    expect(move).toBeDefined();
    next = applyMove(next, move as Move);
  }
  return next;
}

describe('diceFaces', () => {
  it('gives a double four faces, none spent before a move is played', () => {
    const faces = diceFaces(rolled([3, 3]));
    expect(faces).toHaveLength(4);
    expect(faces.map((f) => f.value)).toEqual([3, 3, 3, 3]);
    expect(faces.every((f) => !f.spent)).toBe(true);
  });

  it('spends one face per move played, not all four', () => {
    const faces = diceFaces(playSome(rolled([3, 3]), 2));
    expect(faces.filter((f) => f.spent)).toHaveLength(2);
    expect(faces.filter((f) => !f.spent)).toHaveLength(2);
  });

  it('keys every face uniquely so identical doubles do not collide', () => {
    const keys = diceFaces(rolled([6, 6])).map((f) => f.key);
    expect(new Set(keys).size).toBe(4);
  });
});

describe('rollSummary', () => {
  it('flags a fresh double and counts all four as unplayed', () => {
    const roll = rollSummary(diceFaces(rolled([5, 5])));
    expect(roll.isDouble).toBe(true);
    expect(roll.value).toBe(5);
    expect(roll.total).toBe(4);
    expect(roll.remaining).toBe(4);
    expect(roll.countLabel).toBe('4 of 4 left');
    expect(roll.label).toBe('Double 5s — four moves, four of four still to play.');
  });

  it('counts down as the double is spent', () => {
    const roll = rollSummary(diceFaces(playSome(rolled([4, 4]), 3)));
    expect(roll.isDouble).toBe(true);
    expect(roll.remaining).toBe(1);
    expect(roll.countLabel).toBe('1 of 4 left');
    expect(roll.label).toBe('Double 4s — four moves, one of four still to play.');
  });

  it('says so plainly once every die of a double is gone', () => {
    const roll = rollSummary(diceFaces(playSome(rolled([1, 1]), 4)));
    expect(roll.remaining).toBe(0);
    expect(roll.countLabel).toBe('all 4 played');
    expect(roll.label).toBe('Double 1s — four moves, all four played.');
  });

  it('leaves a normal roll unbadged', () => {
    const roll = rollSummary(diceFaces(rolled([6, 3])));
    expect(roll.isDouble).toBe(false);
    expect(roll.value).toBeNull();
    expect(roll.total).toBe(2);
    expect(roll.label).toBe('Rolled 6 and 3 — two of two still to play.');
  });

  it('counts a half-played normal roll', () => {
    const roll = rollSummary(diceFaces(playSome(rolled([6, 3]), 1)));
    expect(roll.isDouble).toBe(false);
    expect(roll.remaining).toBe(1);
    expect(roll.countLabel).toBe('1 of 2 left');
  });

  it('is empty-safe, because there is no roll outside the moving phase', () => {
    const roll = rollSummary([]);
    expect(roll.isDouble).toBe(false);
    expect(roll.remaining).toBe(0);
    expect(roll.total).toBe(0);
  });
});

describe('viewerOf / viewerSeatOf', () => {
  const seat = (player: Player, name: string, isJev = false): Seat => ({
    playerId: `${player}-1`,
    name,
    player,
    chips: 1000,
    connected: true,
    isComputer: isJev,
    isJev,
  });

  const snapshot = (you: Player | null): RoomSnapshot => ({
    code: 'ABCDE',
    status: 'playing',
    mode: you === null ? 'jev-demo' : 'standard',
    stake: 25,
    seats: [seat('white', you === null ? 'Jev' : 'Alice', you === null), seat('black', 'Computer')],
    you,
    game: null,
    legalMoves: [],
    canEndTurn: false,
    canDouble: false,
    log: [],
    lastResult: null,
    rematchRequestedBy: [],
    jev: null,
  });

  it('draws the board from a seated player\u2019s own colour', () => {
    expect(viewerOf(snapshot('black'))).toBe('black');
    expect(viewerSeatOf(snapshot('black'))?.name).toBe('Computer');
  });

  it('falls back to white for a watcher, which is the seat Jev takes', () => {
    expect(viewerOf(snapshot(null))).toBe('white');
  });

  it('resolves the watcher\u2019s near seat to Jev, not to an empty seat', () => {
    // The regression this guards: looking the near seat up from `snapshot.you`
    // returns null for a watcher, and the rail then renders "Empty seat"
    // underneath a board Jev is actively playing.
    const near = viewerSeatOf(snapshot(null));
    expect(near).not.toBeNull();
    expect(near?.name).toBe('Jev');
    expect(near?.isJev).toBe(true);
  });
});
