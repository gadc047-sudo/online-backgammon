/**
 * The turn state machine (CLAUDE.md principle 3).
 *
 * Every function is pure: mutators take a state and return a NEW one. The
 * engine never generates dice - the server supplies them from a CSPRNG
 * (principle 1), so `applyRoll` and `applyOpeningRoll` take the values as
 * arguments.
 */

import {
  IllegalMoveError,
  type DieValue,
  type GameState,
  type Move,
  type Player,
} from './types';
import { applyMoveToBoard, initialBoard, winTypeFor } from './board';
import { expandDice, legalContinuations } from './moves';

export function opponentOf(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

export function createGame(): GameState {
  return {
    board: initialBoard(),
    phase: 'opening-roll',
    // Placeholder only - the opening roll decides who actually starts.
    turn: 'white',
    cube: { value: 1, owner: null },
    roll: null,
    dice: [],
    movesPlayed: [],
    turnStartBoard: null,
    openingRolls: {},
    cubeOfferedBy: null,
    winner: null,
    winType: null,
    winReason: null,
  };
}

export function applyOpeningRoll(
  state: GameState,
  player: Player,
  die: DieValue,
): GameState {
  if (state.phase !== 'opening-roll') {
    throw new IllegalMoveError('The opening roll is over.');
  }
  if (state.openingRolls[player] !== undefined) {
    throw new IllegalMoveError(`${player} has already made an opening roll.`);
  }

  const openingRolls: Partial<Record<Player, DieValue>> = { ...state.openingRolls };
  openingRolls[player] = die;

  const white = openingRolls.white;
  const black = openingRolls.black;
  if (white === undefined || black === undefined) {
    return { ...state, openingRolls };
  }

  // A tie is discarded entirely and both players roll again.
  if (white === black) {
    return { ...state, openingRolls: {} };
  }

  const whiteWins = white > black;
  const turn: Player = whiteWins ? 'white' : 'black';
  const roll: readonly [DieValue, DieValue] = whiteWins ? [white, black] : [black, white];

  return {
    ...state,
    openingRolls,
    turn,
    phase: 'moving',
    roll,
    dice: expandDice(roll),
    turnStartBoard: state.board,
    movesPlayed: [],
  };
}

export function applyRoll(
  state: GameState,
  roll: readonly [DieValue, DieValue],
): GameState {
  if (state.phase !== 'awaiting-roll') {
    throw new IllegalMoveError('Not waiting for a roll.');
  }
  return {
    ...state,
    roll,
    dice: expandDice(roll),
    turnStartBoard: state.board,
    movesPlayed: [],
    phase: 'moving',
  };
}

export function remainingDice(state: GameState): DieValue[] {
  const remaining = state.dice.slice();
  for (const move of state.movesPlayed) {
    const index = remaining.indexOf(move.die);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

export function legalMovesNow(state: GameState): Move[] {
  if (state.phase !== 'moving' || state.turnStartBoard === null) return [];
  return legalContinuations(
    state.turnStartBoard,
    state.turn,
    state.dice,
    state.movesPlayed,
  );
}

export function canEndTurn(state: GameState): boolean {
  return state.phase === 'moving' && legalMovesNow(state).length === 0;
}

export function applyMove(state: GameState, move: Move): GameState {
  if (state.phase !== 'moving') {
    throw new IllegalMoveError('No move can be made right now.');
  }

  // Use the engine's own move object, so `hit` is authoritative even if the
  // client sent it wrong (principle 1).
  const canonical = legalMovesNow(state).find(
    (candidate) =>
      candidate.from === move.from &&
      candidate.to === move.to &&
      candidate.die === move.die,
  );
  if (!canonical) {
    throw new IllegalMoveError(
      `Illegal move: ${String(move.from)} to ${String(move.to)} with ${move.die}.`,
    );
  }

  const board = applyMoveToBoard(state.board, state.turn, canonical);
  const movesPlayed = [...state.movesPlayed, canonical];

  if (board.off[state.turn] === 15) {
    return {
      ...state,
      board,
      movesPlayed,
      phase: 'game-over',
      winner: state.turn,
      winType: winTypeFor(board, state.turn),
      winReason: 'bear-off',
    };
  }

  return { ...state, board, movesPlayed };
}

export function undoLastMove(state: GameState): GameState {
  if (state.phase !== 'moving') {
    throw new IllegalMoveError('Nothing to undo outside a turn.');
  }
  if (state.movesPlayed.length === 0) {
    throw new IllegalMoveError('No moves have been played this turn.');
  }
  const turnStartBoard = state.turnStartBoard;
  if (turnStartBoard === null) {
    throw new IllegalMoveError('No turn-start board to replay from.');
  }

  const movesPlayed = state.movesPlayed.slice(0, -1);
  let board = turnStartBoard;
  for (const move of movesPlayed) {
    board = applyMoveToBoard(board, state.turn, move);
  }

  return { ...state, board, movesPlayed };
}

export function endTurn(state: GameState): GameState {
  if (state.phase !== 'moving') {
    throw new IllegalMoveError('There is no turn to end.');
  }
  if (!canEndTurn(state)) {
    throw new IllegalMoveError('There are still legal moves to play.');
  }
  return {
    ...state,
    turn: opponentOf(state.turn),
    phase: 'awaiting-roll',
    roll: null,
    dice: [],
    movesPlayed: [],
    turnStartBoard: null,
  };
}

export function resign(state: GameState, player: Player): GameState {
  if (state.phase === 'game-over') {
    throw new IllegalMoveError('The game is already over.');
  }
  return {
    ...state,
    phase: 'game-over',
    winner: opponentOf(player),
    winType: 'single',
    winReason: 'resign',
  };
}
