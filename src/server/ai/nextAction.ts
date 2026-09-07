/**
 * Pure "what should the computer do right now" decision.
 *
 * Deliberately decoupled from `Room`/`RoomRegistry` so it can be unit tested
 * with plain objects and so the driver can recompute it fresh every time
 * rather than trusting a stale plan — the only state this reads is exactly
 * what a human player would see in their own snapshot.
 */

import {
  canDouble,
  canEndTurn,
  legalMovesNow,
  opponentOf,
  type GameState,
  type Move,
  type Player,
} from '../../engine';
import type { RoomStatus } from '../../shared/protocol';
import { chooseSequence, shouldAcceptDouble, shouldOfferDouble } from './strategy';

export type ComputerAction =
  | { readonly type: 'openingRoll' }
  | { readonly type: 'roll' }
  | { readonly type: 'offerDouble' }
  | { readonly type: 'move'; readonly move: Move }
  | { readonly type: 'endTurn' }
  | { readonly type: 'respondToDouble'; readonly accept: boolean }
  | { readonly type: 'rematch' };

export interface ComputerActionContext {
  readonly status: RoomStatus;
  readonly game: GameState | null;
  readonly rematchRequestedBy: readonly Player[];
}

export function nextComputerAction(ctx: ComputerActionContext, computer: Player): ComputerAction | null {
  const { game } = ctx;
  if (!game) return null;

  if (ctx.status === 'game-over') {
    if (ctx.rematchRequestedBy.includes(computer)) return null;
    return { type: 'rematch' };
  }

  switch (game.phase) {
    case 'opening-roll':
      if (game.openingRolls[computer] !== undefined) return null;
      // Wait for the human to go first: rolling on its own the instant the
      // table is created would race the human's own roll over the wire.
      if (game.openingRolls[opponentOf(computer)] === undefined) return null;
      return { type: 'openingRoll' };

    case 'awaiting-roll':
      if (game.turn !== computer) return null;
      if (canDouble(game, computer) && shouldOfferDouble(game, computer)) {
        return { type: 'offerDouble' };
      }
      return { type: 'roll' };

    case 'moving': {
      if (game.turn !== computer) return null;
      if (canEndTurn(game)) return { type: 'endTurn' };
      if (legalMovesNow(game).length === 0) return null;

      const turnStartBoard = game.turnStartBoard;
      if (!turnStartBoard) return null;
      const sequence = chooseSequence(turnStartBoard, computer, game.dice);
      const move = sequence[game.movesPlayed.length];
      return move ? { type: 'move', move } : { type: 'endTurn' };
    }

    case 'cube-offered':
      if (game.turn !== computer) return null;
      return { type: 'respondToDouble', accept: shouldAcceptDouble(game, computer) };

    case 'game-over':
    default:
      return null;
  }
}
