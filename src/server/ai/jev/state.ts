/**
 * Builds the structured `state` Jev is asked about.
 *
 * Per the TypeSafe docs, state carries the material and questions carry the
 * judgment — so nothing here is a question and nothing here is an opinion.
 * It is the position as the engine holds it, plus the derived counts a
 * backgammon player would read off the board anyway (pips, race lead, blots,
 * primes), named so the question's instructions can refer to them directly.
 *
 * Named JSON fields rather than a rendered board diagram: the docs recommend an
 * object when state has several parts, and a field the model can name is a
 * field the question can point at.
 */

import {
  pipCount,
  type BoardState,
  type DieValue,
  type GameState,
  type Player,
} from '../../../engine';
import type { JsonValue } from '../../typesafe/client';
import { blotPoints, longestPrime, madePoints } from './describe';

function opponentOf(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

interface SideProfile {
  readonly colour: Player;
  readonly moves: string;
  readonly home_board: string;
  readonly pip_count: number;
  readonly checkers_on_bar: number;
  readonly checkers_borne_off: number;
  readonly blots: readonly number[];
  readonly points_held: number;
  readonly longest_prime: number;
}

function sideProfile(board: BoardState, player: Player): SideProfile {
  return {
    colour: player,
    moves: player === 'white' ? 'from point 24 down to point 1' : 'from point 1 up to point 24',
    home_board: player === 'white' ? 'points 1-6' : 'points 19-24',
    pip_count: pipCount(board, player),
    checkers_on_bar: board.bar[player],
    checkers_borne_off: board.off[player],
    blots: blotPoints(board, player),
    points_held: madePoints(board, player),
    longest_prime: longestPrime(board, player),
  };
}

/** Occupied points only. Twenty-four entries of mostly zeroes is noise. */
function occupiedPoints(board: BoardState): JsonValue {
  const occupied: JsonValue[] = [];
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (!state || state.color === null || state.count === 0) continue;
    occupied.push({ point: p, owner: state.color, checkers: state.count });
  }
  return occupied;
}

export interface JevStateOptions {
  readonly game: GameState;
  /** The seat Jev is playing. Every `you`/`your` field is from this side. */
  readonly jev: Player;
  readonly stake: number;
  /** Dice still to play. Omitted outside the `moving` phase. */
  readonly diceRemaining?: readonly DieValue[];
}

export function buildJevState(options: JevStateOptions): JsonValue {
  const { game, jev, stake } = options;
  const board = game.board;
  const opponent = opponentOf(jev);
  const you = sideProfile(board, jev);
  const them = sideProfile(board, opponent);

  const state: Record<string, JsonValue> = {
    game: 'backgammon, single game, doubling cube in play',
    board_numbering:
      'Points are numbered 1 to 24 in fixed absolute terms and are never renumbered per player. ' +
      'White moves from high numbers to low and bears off past point 1. ' +
      'Black moves from low numbers to high and bears off past point 24. ' +
      'A point held by two or more checkers cannot be landed on by the other side. ' +
      'A lone checker is a blot and is sent to the bar if the other side lands on it.',
    you: you as unknown as JsonValue,
    opponent: them as unknown as JsonValue,
    race: {
      your_pip_count: you.pip_count,
      opponent_pip_count: them.pip_count,
      // Positive means Jev is ahead: fewer pips left to travel.
      your_pip_lead: them.pip_count - you.pip_count,
    },
    board: {
      occupied_points: occupiedPoints(board),
      bar: { white: board.bar.white, black: board.bar.black },
      borne_off: { white: board.off.white, black: board.off.black },
    },
    turn: {
      phase: game.phase,
      side_to_act: game.turn,
      it_is_your_turn: game.turn === jev,
    },
    cube: {
      value: game.cube.value,
      owner: game.cube.owner ?? 'centred — either side may double',
      value_if_doubled: game.cube.value * 2,
      chips_per_point: stake,
    },
  };

  if (game.roll) state.dice_rolled = [game.roll[0], game.roll[1]];
  if (options.diceRemaining && options.diceRemaining.length > 0) {
    state.dice_still_to_play = [...options.diceRemaining];
  }

  return state;
}
