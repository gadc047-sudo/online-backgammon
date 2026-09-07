/**
 * game.ts - the turn state machine (CLAUDE.md principle 3).
 *
 * Written against src/engine/CONTRACT.md section "src/engine/game.ts". The
 * contract is the spec; where a fixture appears its comment states the exact
 * position AND the rule that position exists to probe.
 *
 * Geometry recap - the single asymmetry that breeds bugs:
 *   white  moves 24 -> 1,  home 1..6,    bar entry on 25 - die  (points 19..24)
 *   black  moves 1  -> 24, home 19..24,  bar entry on die       (points 1..6)
 */

import {
  IllegalMoveError,
  applyMove,
  applyOpeningRoll,
  applyRoll,
  boardKey,
  canEndTurn,
  checkersOnBoard,
  createGame,
  distanceToOff,
  endTurn,
  initialBoard,
  legalMovesNow,
  makeBoard,
  moveDistance,
  opponentOf,
  pipCount,
  pointAt,
  remainingDice,
  resign,
  undoLastMove,
} from './index';
import type { DieValue, GameState, Move, MovePoint, Player } from './index';

// ---------------------------------------------------------------------------
// Helpers. noUncheckedIndexedAccess is on, so nothing here indexes blindly.
// ---------------------------------------------------------------------------

function gameWith(overrides: Partial<GameState>): GameState {
  return { ...createGame(), ...overrides };
}

/** First legal move, with a real failure message instead of a `!` assertion. */
function firstMove(state: GameState): Move {
  const moves = legalMovesNow(state);
  const move = moves[0];
  if (!move) throw new Error('fixture error: expected at least one legal move');
  return move;
}

function findMove(
  state: GameState,
  from: MovePoint,
  to: MovePoint,
  die: DieValue,
): Move {
  const found = legalMovesNow(state).find(
    (m) => m.from === from && m.to === to && m.die === die,
  );
  if (!found) {
    throw new Error(
      `fixture error: ${String(from)} -> ${String(to)} with ${die} is not legal here`,
    );
  }
  return found;
}

/** Total checkers a colour owns anywhere. Must be 15 at every instant. */
function totalCheckers(state: GameState, player: Player): number {
  return (
    checkersOnBoard(state.board, player) +
    state.board.bar[player] +
    state.board.off[player]
  );
}

const NON_MOVING_PHASES = [
  'opening-roll',
  'awaiting-roll',
  'cube-offered',
  'game-over',
] as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * White to play [5, 3] from a near-opening position with a BLACK BLOT ON 3.
 * White 24:2, 13:5, 8:3, 6:5 (15). Black 19:5, 17:3, 12:5, 3:1, 1:1 (15).
 *
 * Probes the canonical-move rule. Both of these are first hops of a length-2
 * sequence, so both appear in legalMovesNow:
 *   8  -> 3 with a 5  IS a hit (lone black checker on 3)
 *   13 -> 8 with a 5  is NOT a hit (three white checkers already on 8)
 */
function blotOnThreePosition(): GameState {
  return gameWith({
    phase: 'awaiting-roll',
    turn: 'white',
    board: makeBoard({
      white: { 24: 2, 13: 5, 8: 3, 6: 5 },
      black: { 19: 5, 17: 3, 12: 5, 3: 1, 1: 1 },
    }),
  });
}

/** The same fixture with the dice already rolled: dice = [5, 3]. */
function blotOnThreeRolled(): GameState {
  return applyRoll(blotOnThreePosition(), [5, 3]);
}

/**
 * The same shape but with the BLACK BLOT ON 5, so the hit needs a 3 rather
 * than a 5. Used only by the hop-order test below.
 */
function blotOnFiveRolled(): GameState {
  return applyRoll(
    gameWith({
      phase: 'awaiting-roll',
      turn: 'white',
      board: makeBoard({
        white: { 24: 2, 13: 5, 8: 3, 6: 5 },
        black: { 19: 5, 17: 3, 12: 5, 5: 1, 1: 1 },
      }),
    }),
    [5, 3],
  );
}

/**
 * White has one checker on the bar and BLACK OWNS ALL SIX ENTRY POINTS.
 * White enters on 25 - die, i.e. points 19..24, so two black checkers on each
 * of 19..24 is a complete shut-out. Black 24..19:2 each + 12:3 (15).
 * White bar:1, 13:5, 8:3, 6:5, 4:1 (15).
 *
 * Probes the forced pass: a turn with zero legal moves must still be endable.
 */
function shutOutPosition(): GameState {
  return gameWith({
    phase: 'awaiting-roll',
    turn: 'white',
    board: makeBoard({
      white: { 13: 5, 8: 3, 6: 5, 4: 1 },
      whiteBar: 1,
      black: { 24: 2, 23: 2, 22: 2, 21: 2, 20: 2, 19: 2, 12: 3 },
    }),
  });
}

/**
 * White has 14 borne off and one checker on point 1 (distance 1). Rolling
 * [3, 1] bears it off with either die, so the higher-die rule leaves only the
 * 3. The BLACK half decides the win type, so each caller supplies its own.
 */
function lastCheckerPosition(black: Parameters<typeof makeBoard>[0]): GameState {
  return gameWith({
    phase: 'awaiting-roll',
    turn: 'white',
    board: makeBoard({ white: { 1: 1 }, whiteOff: 14, ...black }),
  });
}

// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('starts in opening-roll with a centred cube and nothing played', () => {
    const state = createGame();

    expect(state.phase).toBe('opening-roll');
    expect(state.cube).toEqual({ value: 1, owner: null });
    expect(state.movesPlayed).toEqual([]);
    expect(state.dice).toEqual([]);
    expect(state.roll).toBeNull();
    expect(state.turnStartBoard).toBeNull();
    expect(state.openingRolls).toEqual({});
    expect(state.cubeOfferedBy).toBeNull();
    expect(state.winner).toBeNull();
    expect(state.winType).toBeNull();
    expect(state.winReason).toBeNull();
    // turn is an explicit placeholder - the opening roll decides who starts.
    expect(state.turn).toBe('white');
  });

  it('starts from the standard opening position, 167 pips each', () => {
    const state = createGame();

    expect(boardKey(state.board)).toBe(boardKey(initialBoard()));
    expect(pipCount(state.board, 'white')).toBe(167);
    expect(pipCount(state.board, 'black')).toBe(167);
    expect(totalCheckers(state, 'white')).toBe(15);
    expect(totalCheckers(state, 'black')).toBe(15);
  });
});

describe('applyOpeningRoll', () => {
  it('records one die and waits for the other player', () => {
    const state = applyOpeningRoll(createGame(), 'white', 5);

    expect(state.openingRolls.white).toBe(5);
    expect(state.openingRolls.black).toBeUndefined();
    expect(state.phase).toBe('opening-roll');
    expect(state.roll).toBeNull();
    expect(state.turnStartBoard).toBeNull();
  });

  it('rejects a second opening roll from the same player', () => {
    const state = applyOpeningRoll(createGame(), 'black', 2);

    expect(() => applyOpeningRoll(state, 'black', 6)).toThrow(IllegalMoveError);
  });

  it('clears BOTH entries and stays in opening-roll on a tie', () => {
    const tied = applyOpeningRoll(
      applyOpeningRoll(createGame(), 'white', 4),
      'black',
      4,
    );

    expect(tied.openingRolls).toEqual({});
    expect(tied.openingRolls.white).toBeUndefined();
    expect(tied.openingRolls.black).toBeUndefined();
    expect(tied.phase).toBe('opening-roll');
    expect(tied.turnStartBoard).toBeNull();
    expect(tied.roll).toBeNull();
    // A re-roll must work straight away.
    expect(applyOpeningRoll(tied, 'white', 6).openingRolls.white).toBe(6);
  });

  it('puts the higher roller on turn with roll ordered [higher, lower]', () => {
    const state = applyOpeningRoll(
      applyOpeningRoll(createGame(), 'white', 3),
      'black',
      6,
    );

    expect(state.turn).toBe('black');
    expect(state.phase).toBe('moving');
    expect(state.roll).toEqual([6, 3]);
    expect(state.dice).toEqual([6, 3]);
    expect(state.movesPlayed).toEqual([]);
    expect(state.turnStartBoard).not.toBeNull();
    expect(boardKey(state.turnStartBoard ?? initialBoard())).toBe(
      boardKey(state.board),
    );
    // openingRolls is kept for display.
    expect(state.openingRolls).toEqual({ white: 3, black: 6 });
  });

  it('works symmetrically when white rolls higher', () => {
    const state = applyOpeningRoll(
      applyOpeningRoll(createGame(), 'black', 2),
      'white',
      5,
    );

    expect(state.turn).toBe('white');
    expect(state.roll).toEqual([5, 2]);
    expect(state.dice).toEqual([5, 2]);
    expect(legalMovesNow(state).length).toBeGreaterThan(0);
  });

  it('throws once the opening roll is over', () => {
    const started = applyOpeningRoll(
      applyOpeningRoll(createGame(), 'white', 1),
      'black',
      4,
    );

    expect(started.phase).toBe('moving');
    expect(() => applyOpeningRoll(started, 'white', 3)).toThrow(IllegalMoveError);
  });
});

describe('applyRoll', () => {
  it('is legal only from awaiting-roll', () => {
    const phases = ['opening-roll', 'moving', 'cube-offered', 'game-over'] as const;
    for (const phase of phases) {
      expect(() => applyRoll(gameWith({ phase }), [4, 2])).toThrow(IllegalMoveError);
    }
  });

  it('expands non-doubles to two dice and snapshots the turn-start board', () => {
    const before = gameWith({ phase: 'awaiting-roll', turn: 'black' });
    const state = applyRoll(before, [6, 2]);

    expect(state.phase).toBe('moving');
    expect(state.roll).toEqual([6, 2]);
    expect(state.dice).toEqual([6, 2]);
    expect(state.movesPlayed).toEqual([]);
    expect(boardKey(state.turnStartBoard ?? initialBoard())).toBe(
      boardKey(before.board),
    );
    // Rolling never moves a checker or changes whose turn it is.
    expect(boardKey(state.board)).toBe(boardKey(before.board));
    expect(state.turn).toBe('black');
  });

  it('expands doubles to four dice', () => {
    const state = applyRoll(gameWith({ phase: 'awaiting-roll', turn: 'white' }), [3, 3]);

    expect(state.roll).toEqual([3, 3]);
    expect(state.dice).toEqual([3, 3, 3, 3]);
  });

  it('clears movesPlayed left over from an earlier turn', () => {
    const stale: Move = { from: 13, to: 8, die: 5, hit: false };
    const state = applyRoll(
      gameWith({ phase: 'awaiting-roll', turn: 'white', movesPlayed: [stale] }),
      [4, 1],
    );

    expect(state.movesPlayed).toEqual([]);
  });
});

describe('remainingDice', () => {
  it('shrinks by the die each move consumes (non-doubles)', () => {
    let state = blotOnThreeRolled();
    expect(remainingDice(state)).toEqual([5, 3]);

    state = applyMove(state, findMove(state, 13, 8, 5));
    expect(remainingDice(state)).toEqual([3]);

    state = applyMove(state, firstMove(state));
    expect(remainingDice(state)).toEqual([]);
  });

  it('shrinks one at a time across a four-hop doubles turn', () => {
    // Standard opening position, white to play 2-2: 24->22, 13->11, 8->6 and
    // 6->4 are all available, so the maximal turn is four hops.
    let state = applyRoll(gameWith({ phase: 'awaiting-roll', turn: 'white' }), [2, 2]);
    expect(state.dice).toEqual([2, 2, 2, 2]);

    const sizes: number[] = [remainingDice(state).length];
    for (let i = 0; i < 4; i += 1) {
      state = applyMove(state, firstMove(state));
      expect(remainingDice(state).every((die) => die === 2)).toBe(true);
      sizes.push(remainingDice(state).length);
    }

    expect(sizes).toEqual([4, 3, 2, 1, 0]);
    // dice itself is the FULL expanded roll and is never shortened.
    expect(state.dice).toEqual([2, 2, 2, 2]);
    expect(state.movesPlayed).toHaveLength(4);
    expect(canEndTurn(state)).toBe(true);
  });
});

describe('legalMovesNow', () => {
  it('is empty outside the moving phase', () => {
    for (const phase of NON_MOVING_PHASES) {
      const state = gameWith({
        phase,
        turn: 'white',
        dice: [6, 5],
        turnStartBoard: initialBoard(),
      });
      expect(legalMovesNow(state)).toEqual([]);
    }
  });

  it('offers real continuations while moving', () => {
    const moves = legalMovesNow(blotOnThreeRolled());

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.die === 5 || m.die === 3)).toBe(true);
    expect(moves.every((m) => m.from !== 'off')).toBe(true);
  });
});

describe('applyMove', () => {
  it('rejects a fabricated move that no legal sequence contains', () => {
    const state = blotOnThreeRolled();

    // Dice are [5, 3]; a 1-pip hop is pure fiction.
    expect(() => applyMove(state, { from: 24, to: 23, die: 1, hit: false })).toThrow(
      IllegalMoveError,
    );
    // Right die, wrong distance.
    expect(() => applyMove(state, { from: 13, to: 9, die: 5, hit: false })).toThrow(
      IllegalMoveError,
    );
    // Right shape, but 17 holds three black checkers - white may not land there.
    expect(() => applyMove(state, { from: 24, to: 19, die: 5, hit: false })).toThrow(
      IllegalMoveError,
    );
  });

  it('rejects a move once its die has been spent', () => {
    const state = blotOnThreeRolled();
    const played = applyMove(state, findMove(state, 13, 8, 5));

    expect(remainingDice(played)).toEqual([3]);
    expect(() => applyMove(played, { from: 13, to: 8, die: 5, hit: false })).toThrow(
      IllegalMoveError,
    );
  });

  it('rejects any move outside the moving phase', () => {
    const state = blotOnThreePosition();

    expect(state.phase).toBe('awaiting-roll');
    expect(() => applyMove(state, { from: 13, to: 8, die: 5, hit: false })).toThrow(
      IllegalMoveError,
    );
  });

  it('uses the canonical move: a client claiming hit:false still hits', () => {
    const state = blotOnThreeRolled();
    expect(pointAt(state.board, 3)).toEqual({ color: 'black', count: 1 });

    // 8 -> 3 with a 5 lands on a lone black checker. The client lies about it.
    const after = applyMove(state, { from: 8, to: 3, die: 5, hit: false });

    expect(after.board.bar.black).toBe(1);
    expect(pointAt(after.board, 3)).toEqual({ color: 'white', count: 1 });
    expect(pointAt(after.board, 8)).toEqual({ color: 'white', count: 2 });
    // The recorded move carries the server's truth, not the client's claim.
    expect(after.movesPlayed).toEqual([{ from: 8, to: 3, die: 5, hit: true }]);
    expect(totalCheckers(after, 'black')).toBe(15);
    expect(totalCheckers(after, 'white')).toBe(15);
  });

  it('uses the canonical move: a client claiming hit:true does not hit', () => {
    const state = blotOnThreeRolled();

    // 13 -> 8 with a 5 lands on three of white's own checkers. Nothing is hit.
    const after = applyMove(state, { from: 13, to: 8, die: 5, hit: true });

    expect(after.board.bar.black).toBe(0);
    expect(pointAt(after.board, 8)).toEqual({ color: 'white', count: 4 });
    expect(pointAt(after.board, 13)).toEqual({ color: 'white', count: 4 });
    expect(after.movesPlayed).toEqual([{ from: 13, to: 8, die: 5, hit: false }]);
  });

  it('accepts either hop order for the same play', () => {
    // Regression guard for the permutation-dedupe trap called out in
    // CONTRACT.md: white to play 5 and 3 with a black blot on 5. The hit 8/5*
    // uses the LOWER die, so an implementation that prefix-filters
    // legalSequences offers only the representative play that starts with the
    // 5 and rejects 8/5* as an opening hop - a legal move the player simply
    // could not make. Both orders must be accepted and must land on the same
    // board.
    const state = blotOnFiveRolled();
    expect(pointAt(state.board, 5)).toEqual({ color: 'black', count: 1 });

    // Order A: the 3 first (the hit), then the 5.
    const hitFirst = applyMove(state, findMove(state, 8, 5, 3));
    expect(hitFirst.board.bar.black).toBe(1);
    expect(remainingDice(hitFirst)).toEqual([5]);
    const orderA = applyMove(hitFirst, findMove(hitFirst, 13, 8, 5));

    // Order B: the 5 first, then the same hit with the 3.
    const runFirst = applyMove(state, findMove(state, 13, 8, 5));
    const orderB = applyMove(runFirst, findMove(runFirst, 8, 5, 3));

    expect(boardKey(orderA.board)).toBe(boardKey(orderB.board));
    expect(orderA.board.bar.black).toBe(1);
    expect(pointAt(orderA.board, 5)).toEqual({ color: 'white', count: 1 });
    expect(canEndTurn(orderA)).toBe(true);
    expect(canEndTurn(orderB)).toBe(true);
  });

  it('does not mutate the state it was given', () => {
    const state = blotOnThreeRolled();
    const keyBefore = boardKey(state.board);

    applyMove(state, findMove(state, 13, 8, 5));

    expect(boardKey(state.board)).toBe(keyBefore);
    expect(state.movesPlayed).toEqual([]);
  });
});

describe('undoLastMove', () => {
  it('restores the exact board before the last hop', () => {
    const start = blotOnThreeRolled();
    const startKey = boardKey(start.board);

    // First hop is the hit 8 -> 3*, so the undo has to restore the bar too.
    const one = applyMove(start, findMove(start, 8, 3, 5));
    const oneKey = boardKey(one.board);
    expect(one.board.bar.black).toBe(1);

    const two = applyMove(one, firstMove(one));
    expect(two.movesPlayed).toHaveLength(2);

    const undoneOnce = undoLastMove(two);
    expect(boardKey(undoneOnce.board)).toBe(oneKey);
    expect(undoneOnce.movesPlayed).toEqual(one.movesPlayed);

    const undoneTwice = undoLastMove(undoneOnce);
    expect(boardKey(undoneTwice.board)).toBe(startKey);
    expect(undoneTwice.movesPlayed).toEqual([]);
    // The hit rolls back too - black comes back off the bar onto point 3.
    expect(undoneTwice.board.bar.black).toBe(0);
    expect(pointAt(undoneTwice.board, 3)).toEqual({ color: 'black', count: 1 });
  });

  it('leaves the turn, dice and turn-start board alone', () => {
    const start = blotOnThreeRolled();
    const undone = undoLastMove(applyMove(start, findMove(start, 13, 8, 5)));

    expect(undone.phase).toBe('moving');
    expect(undone.turn).toBe('white');
    expect(undone.dice).toEqual([5, 3]);
    expect(remainingDice(undone)).toEqual([5, 3]);
    expect(boardKey(undone.turnStartBoard ?? initialBoard())).toBe(
      boardKey(start.board),
    );
  });

  it('throws when nothing has been played this turn', () => {
    const state = blotOnThreeRolled();

    expect(state.movesPlayed).toEqual([]);
    expect(() => undoLastMove(state)).toThrow(IllegalMoveError);
  });

  it('throws outside the moving phase', () => {
    for (const phase of NON_MOVING_PHASES) {
      const state = gameWith({
        phase,
        turn: 'white',
        dice: [5, 3],
        turnStartBoard: initialBoard(),
        movesPlayed: [{ from: 13, to: 8, die: 5, hit: false }],
      });
      expect(() => undoLastMove(state)).toThrow(IllegalMoveError);
    }
  });
});

describe('canEndTurn / endTurn', () => {
  it('is false while a legal move remains, and endTurn refuses', () => {
    const state = blotOnThreeRolled();

    expect(legalMovesNow(state).length).toBeGreaterThan(0);
    expect(canEndTurn(state)).toBe(false);
    expect(() => endTurn(state)).toThrow(IllegalMoveError);

    // Still false with only one of the two dice played.
    const half = applyMove(state, findMove(state, 13, 8, 5));
    expect(canEndTurn(half)).toBe(false);
    expect(() => endTurn(half)).toThrow(IllegalMoveError);
  });

  it('flips the turn and clears every per-turn field', () => {
    let state = blotOnThreeRolled();
    state = applyMove(state, firstMove(state));
    state = applyMove(state, firstMove(state));
    expect(canEndTurn(state)).toBe(true);

    const keyBeforeEnd = boardKey(state.board);
    const ended = endTurn(state);

    expect(ended.turn).toBe('black');
    expect(ended.phase).toBe('awaiting-roll');
    expect(ended.roll).toBeNull();
    expect(ended.dice).toEqual([]);
    expect(ended.movesPlayed).toEqual([]);
    expect(ended.turnStartBoard).toBeNull();
    // Ending a turn never changes the position.
    expect(boardKey(ended.board)).toBe(keyBeforeEnd);
  });

  it('throws outside the moving phase', () => {
    for (const phase of NON_MOVING_PHASES) {
      expect(canEndTurn(gameWith({ phase }))).toBe(false);
      expect(() => endTurn(gameWith({ phase }))).toThrow(IllegalMoveError);
    }
  });

  it('allows a forced pass when the player on roll is shut out', () => {
    // White on the bar; black holds all six of white's entry points (19..24).
    const state = applyRoll(shutOutPosition(), [6, 5]);

    expect(state.board.bar.white).toBe(1);
    expect(legalMovesNow(state)).toEqual([]);
    expect(canEndTurn(state)).toBe(true);

    const ended = endTurn(state);
    expect(ended.turn).toBe('black');
    expect(ended.phase).toBe('awaiting-roll');
    expect(ended.board.bar.white).toBe(1);
    expect(ended.movesPlayed).toEqual([]);
    expect(boardKey(ended.board)).toBe(boardKey(state.board));
  });

  it('forces a pass for every one of the 36 rolls from a full shut-out', () => {
    const dice: DieValue[] = [1, 2, 3, 4, 5, 6];
    for (const a of dice) {
      for (const b of dice) {
        const state = applyRoll(shutOutPosition(), [a, b]);
        expect(legalMovesNow(state)).toEqual([]);
        expect(canEndTurn(state)).toBe(true);
      }
    }
  });
});

describe('bearing off the fifteenth checker ends the game', () => {
  it('is a single when the loser has borne off at least one checker', () => {
    // Black 19:5, 20:5, 12:4 on the board plus one already off = 15.
    const state = applyRoll(
      lastCheckerPosition({ black: { 19: 5, 20: 5, 12: 4 }, blackOff: 1 }),
      [3, 1],
    );

    // Only one die can be played, so the higher-die rule forces the 3.
    expect(legalMovesNow(state)).toEqual([{ from: 1, to: 'off', die: 3, hit: false }]);

    const over = applyMove(state, firstMove(state));
    expect(over.phase).toBe('game-over');
    expect(over.winner).toBe('white');
    expect(over.winReason).toBe('bear-off');
    expect(over.winType).toBe('single');
    expect(over.board.off.white).toBe(15);
    expect(pipCount(over.board, 'white')).toBe(0);
  });

  it('is a gammon when the loser has none off and none in the winner home', () => {
    // Black 19:5, 20:5, 12:5 = 15. Nothing off, nothing on the bar, nothing in
    // white's home board (1..6).
    const state = applyRoll(
      lastCheckerPosition({ black: { 19: 5, 20: 5, 12: 5 } }),
      [3, 1],
    );

    const over = applyMove(state, firstMove(state));
    expect(over.phase).toBe('game-over');
    expect(over.winner).toBe('white');
    expect(over.winReason).toBe('bear-off');
    expect(over.winType).toBe('gammon');
    expect(over.board.off.black).toBe(0);
  });

  it('is a backgammon when the loser still sits in the winner home board', () => {
    // As the gammon case, but one black checker is stranded on point 3, which
    // is inside white's home board.
    const state = applyRoll(
      lastCheckerPosition({ black: { 19: 5, 20: 5, 12: 4, 3: 1 } }),
      [3, 1],
    );

    const over = applyMove(state, firstMove(state));
    expect(over.phase).toBe('game-over');
    expect(over.winner).toBe('white');
    expect(over.winReason).toBe('bear-off');
    expect(over.winType).toBe('backgammon');
  });

  it('is a backgammon when the loser is still on the bar', () => {
    const state = applyRoll(
      lastCheckerPosition({ black: { 19: 5, 20: 5, 12: 4 }, blackBar: 1 }),
      [3, 1],
    );

    const over = applyMove(state, firstMove(state));
    expect(over.winType).toBe('backgammon');
    expect(over.winReason).toBe('bear-off');
  });
});

describe('resign', () => {
  it('hands a single point to the opponent whatever the position', () => {
    const state = resign(blotOnThreeRolled(), 'white');

    expect(state.phase).toBe('game-over');
    expect(state.winner).toBe('black');
    expect(state.winType).toBe('single');
    expect(state.winReason).toBe('resign');
  });

  it('works for either colour and even during the opening roll', () => {
    const state = resign(createGame(), 'black');

    expect(state.winner).toBe('white');
    expect(state.winType).toBe('single');
    expect(state.winReason).toBe('resign');
  });

  it('throws once the game is over', () => {
    const over = resign(createGame(), 'white');

    expect(() => resign(over, 'black')).toThrow(IllegalMoveError);
  });
});

// ---------------------------------------------------------------------------
// The full scripted game. Highest-value test in the file: it drives the real
// state machine from createGame() to a bear-off win on a fixed dice script and
// checks the pip-count invariants on EVERY hop along the way.
// ---------------------------------------------------------------------------

/** Deterministic dice. Fixed seed, so this test is reproducible forever. */
function diceScript(seed: number): () => DieValue {
  let s = seed >>> 0;
  return (): DieValue => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (((s >>> 16) % 6) + 1) as DieValue;
  };
}

describe('a full scripted game', () => {
  it('runs from the opening roll to a bear-off win with sound pip invariants', () => {
    const nextDie = diceScript(20260907);
    const MAX_TURNS = 600;

    let state = createGame();

    // Opening roll: keep drawing until the two dice differ.
    let whiteDie = nextDie();
    let blackDie = nextDie();
    let ties = 0;
    while (whiteDie === blackDie) {
      whiteDie = nextDie();
      blackDie = nextDie();
      ties += 1;
      expect(ties).toBeLessThan(50);
    }
    state = applyOpeningRoll(state, 'white', whiteDie);
    state = applyOpeningRoll(state, 'black', blackDie);
    expect(state.phase).toBe('moving');

    /**
     * Pip trace, one entry per hop. hitOn names the colour sent to the bar by
     * that hop, if any. Being hit is the ONLY way a pip count can rise in
     * backgammon, so the trace lets the monotonicity claim be checked exactly
     * rather than approximately.
     */
    const pipTrace: Array<{ white: number; black: number; hitOn: Player | null }> = [
      {
        white: pipCount(state.board, 'white'),
        black: pipCount(state.board, 'black'),
        hitOn: null,
      },
    ];

    let turns = 0;
    let hops = 0;
    while (state.phase !== 'game-over') {
      turns += 1;
      expect(turns).toBeLessThanOrEqual(MAX_TURNS);
      if (turns > MAX_TURNS) break;

      if (state.phase === 'awaiting-roll') {
        state = applyRoll(state, [nextDie(), nextDie()]);
      }
      expect(state.phase).toBe('moving');

      let hopsThisTurn = 0;
      while (state.phase === 'moving' && !canEndTurn(state)) {
        hopsThisTurn += 1;
        expect(hopsThisTurn).toBeLessThanOrEqual(state.dice.length);

        const mover = state.turn;
        const foe = opponentOf(mover);
        const moverPipBefore = pipCount(state.board, mover);
        const foePipBefore = pipCount(state.board, foe);

        const move = firstMove(state);
        // No hop ever travels backwards: the distance is strictly positive.
        const advance = moveDistance(mover, move.from, move.to);
        expect(advance).toBeGreaterThan(0);

        state = applyMove(state, move);
        hops += 1;

        // The mover's pip count drops by exactly the distance travelled. For a
        // bear-off with an oversized die that is the checker's distance, not
        // the die - which is precisely the case this catches.
        expect(pipCount(state.board, mover)).toBe(moverPipBefore - advance);

        // The opponent's pip count is untouched unless this hop hit them, in
        // which case the hit checker jumps back to distance 25.
        const hitCost = move.hit ? 25 - distanceToOff(foe, move.to) : 0;
        expect(pipCount(state.board, foe)).toBe(foePipBefore + hitCost);

        expect(remainingDice(state).length).toBe(
          state.dice.length - state.movesPlayed.length,
        );
        expect(totalCheckers(state, 'white')).toBe(15);
        expect(totalCheckers(state, 'black')).toBe(15);

        pipTrace.push({
          white: pipCount(state.board, 'white'),
          black: pipCount(state.board, 'black'),
          hitOn: move.hit ? foe : null,
        });
      }

      if (state.phase === 'game-over') break;

      const before = state.turn;
      state = endTurn(state);
      expect(state.turn).toBe(opponentOf(before));
      expect(state.phase).toBe('awaiting-roll');
    }

    // Terminated by actually bearing off, not by tripping the guard.
    expect(turns).toBeLessThan(MAX_TURNS);
    expect(state.phase).toBe('game-over');
    expect(state.winReason).toBe('bear-off');
    expect(state.winner).not.toBeNull();

    const winner = state.winner;
    if (winner === null) throw new Error('winner must be set in game-over');
    const loser = opponentOf(winner);

    expect(state.board.off[winner]).toBe(15);
    expect(checkersOnBoard(state.board, winner)).toBe(0);
    expect(state.board.bar[winner]).toBe(0);
    expect(pipCount(state.board, winner)).toBe(0);
    expect(totalCheckers(state, loser)).toBe(15);
    expect(['single', 'gammon', 'backgammon']).toContain(state.winType);

    // A real game, not a two-move artefact.
    expect(hops).toBeGreaterThan(60);
    expect(pipCount(state.board, loser)).toBeLessThan(167);

    // The loser's pip count only ever decreased, except on the hops where the
    // winner hit them. Asserting bare monotonicity would be WRONG: a hit
    // legitimately sends the loser backwards, and that is the only exception.
    for (let i = 1; i < pipTrace.length; i += 1) {
      const prev = pipTrace[i - 1];
      const cur = pipTrace[i];
      if (!prev || !cur) throw new Error('pip trace is dense by construction');
      if (cur.hitOn === loser) {
        expect(cur[loser]).toBeGreaterThan(prev[loser]);
        continue;
      }
      expect(cur[loser]).toBeLessThanOrEqual(prev[loser]);
    }
  });
});
