/**
 * cube.ts - the doubling cube and point settlement.
 *
 * Written against src/engine/CONTRACT.md section "src/engine/cube.ts".
 *
 * The two rules that carry all the risk in a betting game, even a play-money
 * one, are OWNERSHIP GATING (only the cube's owner may redouble) and the PASS
 * VALUE (a declined double settles at the pre-double value, never the doubled
 * one). Both are tested here from several directions.
 *
 * Everything is scored in POINTS. Chips are the server's problem.
 */

import {
  IllegalMoveError,
  canDouble,
  createGame,
  nextCubeValue,
  offerDouble,
  opponentOf,
  pointsWon,
  respondToDouble,
  winMultiplier,
} from './index';
import type { CubeValue, GameState, Player, WinType } from './index';

function gameWith(overrides: Partial<GameState>): GameState {
  return { ...createGame(), ...overrides };
}

/** A live game waiting on `turn` to roll, with the cube in the given state. */
function awaitingRoll(turn: Player, value: CubeValue, owner: Player | null): GameState {
  return gameWith({ phase: 'awaiting-roll', turn, cube: { value, owner } });
}

const ALL_PLAYERS: readonly Player[] = ['white', 'black'];

describe('nextCubeValue', () => {
  it('doubles through the whole ladder', () => {
    expect(nextCubeValue(1)).toBe(2);
    expect(nextCubeValue(2)).toBe(4);
    expect(nextCubeValue(4)).toBe(8);
    expect(nextCubeValue(8)).toBe(16);
    expect(nextCubeValue(16)).toBe(32);
    expect(nextCubeValue(32)).toBe(64);
  });

  it('stops at the 64 ceiling', () => {
    expect(nextCubeValue(64)).toBe(64);
    // Idempotent, so a buggy caller cannot walk past the cap.
    expect(nextCubeValue(nextCubeValue(64))).toBe(64);
  });
});

describe('canDouble', () => {
  it('is true for the player on roll when the cube is centred', () => {
    for (const player of ALL_PLAYERS) {
      expect(canDouble(awaitingRoll(player, 1, null), player)).toBe(true);
    }
  });

  it('is true for the owner of the cube on their roll', () => {
    expect(canDouble(awaitingRoll('white', 4, 'white'), 'white')).toBe(true);
    expect(canDouble(awaitingRoll('black', 32, 'black'), 'black')).toBe(true);
  });

  it('is false when it is not your turn', () => {
    const state = awaitingRoll('white', 1, null);

    expect(canDouble(state, 'black')).toBe(false);
    // Even for the owner: ownership does not override turn order.
    expect(canDouble(awaitingRoll('white', 2, 'black'), 'black')).toBe(false);
  });

  it('is false mid-turn (phase moving)', () => {
    const state = gameWith({
      phase: 'moving',
      turn: 'white',
      roll: [5, 3],
      dice: [5, 3],
      turnStartBoard: createGame().board,
      cube: { value: 1, owner: null },
    });

    expect(canDouble(state, 'white')).toBe(false);
  });

  it('is false during the opening roll', () => {
    const state = createGame();

    expect(state.phase).toBe('opening-roll');
    expect(canDouble(state, 'white')).toBe(false);
    expect(canDouble(state, 'black')).toBe(false);
  });

  it('is false once the game is over', () => {
    const state = gameWith({
      phase: 'game-over',
      turn: 'white',
      winner: 'white',
      winType: 'single',
      winReason: 'resign',
    });

    expect(canDouble(state, 'white')).toBe(false);
    expect(canDouble(state, 'black')).toBe(false);
  });

  it('is false while a double is already on the table', () => {
    const state = gameWith({
      phase: 'cube-offered',
      turn: 'black',
      cubeOfferedBy: 'white',
      cube: { value: 1, owner: null },
    });

    expect(canDouble(state, 'black')).toBe(false);
    expect(canDouble(state, 'white')).toBe(false);
  });

  it('is false when the opponent owns the cube', () => {
    // White is on roll but black holds the cube after taking an earlier double.
    const state = awaitingRoll('white', 2, 'black');

    expect(canDouble(state, 'white')).toBe(false);
  });

  it('is false at the 64 ceiling even for the owner on roll', () => {
    expect(canDouble(awaitingRoll('white', 64, 'white'), 'white')).toBe(false);
    expect(canDouble(awaitingRoll('white', 32, 'white'), 'white')).toBe(true);
  });
});

describe('offerDouble', () => {
  it('opens the offer without changing the cube value', () => {
    const before = awaitingRoll('white', 2, 'white');
    const state = offerDouble(before, 'white');

    expect(state.phase).toBe('cube-offered');
    expect(state.cubeOfferedBy).toBe('white');
    // The responder must act next, so the turn passes to them.
    expect(state.turn).toBe('black');
    // Value is NOT applied until the offer is taken.
    expect(state.cube).toEqual({ value: 2, owner: 'white' });
    expect(before.phase).toBe('awaiting-roll');
  });

  it('works from a centred cube for either colour', () => {
    for (const player of ALL_PLAYERS) {
      const state = offerDouble(awaitingRoll(player, 1, null), player);

      expect(state.cubeOfferedBy).toBe(player);
      expect(state.turn).toBe(opponentOf(player));
      expect(state.cube).toEqual({ value: 1, owner: null });
    }
  });

  it('throws whenever canDouble is false', () => {
    // Not your turn.
    expect(() => offerDouble(awaitingRoll('white', 1, null), 'black')).toThrow(
      IllegalMoveError,
    );
    // Opponent owns the cube.
    expect(() => offerDouble(awaitingRoll('white', 2, 'black'), 'white')).toThrow(
      IllegalMoveError,
    );
    // Cube is maxed out.
    expect(() => offerDouble(awaitingRoll('white', 64, 'white'), 'white')).toThrow(
      IllegalMoveError,
    );
    // Opening roll.
    expect(() => offerDouble(createGame(), 'white')).toThrow(IllegalMoveError);
    // Mid-turn.
    expect(() =>
      offerDouble(gameWith({ phase: 'moving', turn: 'white' }), 'white'),
    ).toThrow(IllegalMoveError);
    // Game over.
    expect(() =>
      offerDouble(gameWith({ phase: 'game-over', turn: 'white' }), 'white'),
    ).toThrow(IllegalMoveError);
  });
});

describe('respondToDouble - take', () => {
  it('doubles the value, hands the cube to the taker, returns the roll', () => {
    const offered = offerDouble(awaitingRoll('white', 1, null), 'white');
    const taken = respondToDouble(offered, 'black', true);

    expect(taken.cube).toEqual({ value: 2, owner: 'black' });
    expect(taken.cubeOfferedBy).toBeNull();
    // The DOUBLER still rolls and plays this turn.
    expect(taken.turn).toBe('white');
    expect(taken.phase).toBe('awaiting-roll');
    expect(taken.winner).toBeNull();
    expect(taken.winType).toBeNull();
    expect(taken.winReason).toBeNull();
  });

  it('climbs the ladder correctly from a redouble', () => {
    // Black owns the cube at 4 and redoubles to 8; white takes.
    const offered = offerDouble(awaitingRoll('black', 4, 'black'), 'black');
    const taken = respondToDouble(offered, 'white', true);

    expect(taken.cube).toEqual({ value: 8, owner: 'white' });
    expect(taken.turn).toBe('black');
    expect(taken.phase).toBe('awaiting-roll');
  });

  it('gates ownership: after a take only the new owner may double', () => {
    // White doubles from centre, black takes.
    const taken = respondToDouble(
      offerDouble(awaitingRoll('white', 1, null), 'white'),
      'black',
      true,
    );
    expect(taken.cube).toEqual({ value: 2, owner: 'black' });

    // It is white's roll, but white no longer holds the cube.
    expect(taken.turn).toBe('white');
    expect(canDouble(taken, 'white')).toBe(false);
    expect(() => offerDouble(taken, 'white')).toThrow(IllegalMoveError);
    // Black holds it but it is not black's turn yet.
    expect(canDouble(taken, 'black')).toBe(false);

    // Once the roll comes round to black, black - and only black - may double.
    const blacksTurn = { ...taken, turn: 'black' as Player };
    expect(canDouble(blacksTurn, 'black')).toBe(true);
    expect(canDouble(blacksTurn, 'white')).toBe(false);
    expect(offerDouble(blacksTurn, 'black').cubeOfferedBy).toBe('black');
  });
});

describe('respondToDouble - pass', () => {
  it('gives the OFFERER the game at the PRE-double value', () => {
    const offered = offerDouble(awaitingRoll('white', 2, 'white'), 'white');
    const passed = respondToDouble(offered, 'black', false);

    expect(passed.phase).toBe('game-over');
    expect(passed.winner).toBe('white');
    expect(passed.winType).toBe('single');
    expect(passed.winReason).toBe('cube-pass');
    // The double is never applied: settlement is at 2, not 4.
    expect(passed.cube.value).toBe(2);
    expect(pointsWon(passed)).toBe(2);
  });

  it('settles an initial double at one point, not two', () => {
    const passed = respondToDouble(
      offerDouble(awaitingRoll('black', 1, null), 'black'),
      'white',
      false,
    );

    expect(passed.winner).toBe('black');
    expect(passed.cube.value).toBe(1);
    expect(pointsWon(passed)).toBe(1);
  });

  it('is a single even when the position looks like a gammon', () => {
    // A pass never scores a gammon or backgammon, whatever is on the board.
    const passed = respondToDouble(
      offerDouble(awaitingRoll('white', 8, 'white'), 'white'),
      'black',
      false,
    );

    expect(passed.winType).toBe('single');
    expect(pointsWon(passed)).toBe(8);
  });
});

describe('respondToDouble - rejection cases', () => {
  it('throws when the wrong player answers', () => {
    const offered = offerDouble(awaitingRoll('white', 1, null), 'white');

    expect(offered.turn).toBe('black');
    // The offerer cannot take or pass their own double.
    expect(() => respondToDouble(offered, 'white', true)).toThrow(IllegalMoveError);
    expect(() => respondToDouble(offered, 'white', false)).toThrow(IllegalMoveError);
  });

  it('throws outside the cube-offered phase', () => {
    const phases = ['opening-roll', 'awaiting-roll', 'moving', 'game-over'] as const;
    for (const phase of phases) {
      const state = gameWith({ phase, turn: 'black', cubeOfferedBy: 'white' });
      expect(() => respondToDouble(state, 'black', true)).toThrow(IllegalMoveError);
      expect(() => respondToDouble(state, 'black', false)).toThrow(IllegalMoveError);
    }
  });

  it('throws when no offerer was recorded', () => {
    // Defensive: a cube-offered state with a null offerer is corrupt.
    const state = gameWith({
      phase: 'cube-offered',
      turn: 'black',
      cubeOfferedBy: null,
    });

    expect(() => respondToDouble(state, 'black', true)).toThrow(IllegalMoveError);
  });
});

describe('winMultiplier', () => {
  it('is 1 / 2 / 3 for single / gammon / backgammon', () => {
    expect(winMultiplier('single')).toBe(1);
    expect(winMultiplier('gammon')).toBe(2);
    expect(winMultiplier('backgammon')).toBe(3);
  });
});

describe('pointsWon', () => {
  function finished(value: CubeValue, winType: WinType): GameState {
    return gameWith({
      phase: 'game-over',
      cube: { value, owner: 'white' },
      winner: 'white',
      winType,
      winReason: 'bear-off',
    });
  }

  it('is 0 while the game is still live', () => {
    expect(pointsWon(createGame())).toBe(0);
    expect(pointsWon(awaitingRoll('white', 4, 'white'))).toBe(0);
    expect(pointsWon(gameWith({ phase: 'moving', turn: 'white' }))).toBe(0);
    expect(
      pointsWon(offerDouble(awaitingRoll('white', 2, 'white'), 'white')),
    ).toBe(0);
  });

  it('settles a single on a centred cube at 1 point', () => {
    expect(pointsWon(finished(1, 'single'))).toBe(1);
  });

  it('settles a gammon on a cube of 2 at 4 points', () => {
    expect(pointsWon(finished(2, 'gammon'))).toBe(4);
  });

  it('settles a backgammon on a cube of 4 at 12 points', () => {
    expect(pointsWon(finished(4, 'backgammon'))).toBe(12);
  });

  it('settles a declined double at the pre-double value times 1', () => {
    // Cube already at 2; white offers 4 and black passes. Settlement is 2.
    const passed = respondToDouble(
      offerDouble(awaitingRoll('white', 2, 'white'), 'white'),
      'black',
      false,
    );

    expect(passed.winReason).toBe('cube-pass');
    expect(pointsWon(passed)).toBe(2);
  });

  it('scales across the whole ladder', () => {
    const ladder: CubeValue[] = [1, 2, 4, 8, 16, 32, 64];
    for (const value of ladder) {
      expect(pointsWon(finished(value, 'single'))).toBe(value);
      expect(pointsWon(finished(value, 'gammon'))).toBe(value * 2);
      expect(pointsWon(finished(value, 'backgammon'))).toBe(value * 3);
    }
  });
});
