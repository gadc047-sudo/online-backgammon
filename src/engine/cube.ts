/**
 * Doubling cube rules and settlement value.
 *
 * The cube is centred until someone doubles and the offer is taken; after that
 * only its owner may double again. An offer is a first-class phase, not a flag,
 * because it interrupts normal turn flow (CLAUDE.md principle 3).
 *
 * Everything here is scored in POINTS. Converting points to virtual chips is
 * the server's job - the engine knows nothing about chips.
 */

import {
  IllegalMoveError,
  type CubeValue,
  type GameState,
  type Player,
  type WinType,
} from './types';
import { opponentOf } from './game';

export function nextCubeValue(value: CubeValue): CubeValue {
  return value >= 64 ? 64 : ((value * 2) as CubeValue);
}

export function canDouble(state: GameState, player: Player): boolean {
  if (state.phase !== 'awaiting-roll') return false;
  if (state.turn !== player) return false;
  if (state.cube.owner !== null && state.cube.owner !== player) return false;
  return state.cube.value < 64;
}

export function offerDouble(state: GameState, player: Player): GameState {
  if (!canDouble(state, player)) {
    throw new IllegalMoveError(`${player} may not double right now.`);
  }
  return {
    ...state,
    phase: 'cube-offered',
    cubeOfferedBy: player,
    // The responder must act next, so the turn passes to them for the offer.
    turn: opponentOf(player),
  };
}

export function respondToDouble(
  state: GameState,
  player: Player,
  accept: boolean,
): GameState {
  if (state.phase !== 'cube-offered') {
    throw new IllegalMoveError('There is no double to respond to.');
  }
  if (player !== state.turn) {
    throw new IllegalMoveError(`${player} was not offered the double.`);
  }

  const offerer = state.cubeOfferedBy;
  if (offerer === null) {
    throw new IllegalMoveError('No offerer recorded for this double.');
  }

  if (accept) {
    return {
      ...state,
      cube: { value: nextCubeValue(state.cube.value), owner: player },
      cubeOfferedBy: null,
      // The doubler still rolls and plays their turn.
      turn: offerer,
      phase: 'awaiting-roll',
    };
  }

  // Passing settles at the CURRENT cube value - the double is never applied.
  return {
    ...state,
    phase: 'game-over',
    winner: offerer,
    winType: 'single',
    winReason: 'cube-pass',
  };
}

export function winMultiplier(winType: WinType): 1 | 2 | 3 {
  if (winType === 'gammon') return 2;
  if (winType === 'backgammon') return 3;
  return 1;
}

export function pointsWon(state: GameState): number {
  if (state.phase !== 'game-over' || state.winType === null) return 0;
  return state.cube.value * winMultiplier(state.winType);
}
