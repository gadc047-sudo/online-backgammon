/**
 * Move and cube decisions for the computer opponent.
 *
 * `chooseSequence` reuses the engine's own `legalSequences` — the authoritative
 * generator of every maximal legal play for a turn — rather than re-deriving
 * legality here, so the AI can never propose a move the engine would reject.
 * It is a pure function of the position and dice, so calling it again after
 * each hop of a multi-hop turn (with an unchanged `turnStartBoard` and `dice`)
 * deterministically reproduces the same chosen sequence, and the next hop to
 * play is simply the one at `movesPlayed.length` in it.
 */

import {
  applyMoveToBoard,
  canDouble,
  legalSequences,
  pipCount,
  type BoardState,
  type DieValue,
  type GameState,
  type Move,
  type Player,
} from '../../engine';
import { evaluateBoard } from './evaluate';

export function chooseSequence(board: BoardState, player: Player, dice: readonly DieValue[]): Move[] {
  const candidates = legalSequences(board, player, dice);
  let best = candidates[0] ?? [];
  if (candidates.length <= 1) return best;

  let bestScore = -Infinity;
  for (const sequence of candidates) {
    let after = board;
    for (const move of sequence) after = applyMoveToBoard(after, player, move);
    const score = evaluateBoard(after, player);
    if (score > bestScore) {
      bestScore = score;
      best = sequence;
    }
  }
  return best;
}

/**
 * Rough win probability from a pip-count lead, squashed into (0, 1). Not a
 * substitute for real equity tables, but monotonic in the lead and cheap —
 * enough to drive sensible double/take decisions.
 */
export function estimateWinChance(board: BoardState, player: Player): number {
  const opponent = player === 'white' ? 'black' : 'white';
  const lead = pipCount(board, opponent) - pipCount(board, player);
  return 1 / (1 + Math.exp(-lead / 12));
}

const DOUBLE_FLOOR = 0.68;
/** Above this the market has "gone away": play on for the bigger gammon score instead. */
const DOUBLE_CEILING = 0.92;
const TAKE_FLOOR = 0.25;

export function shouldOfferDouble(game: GameState, player: Player): boolean {
  if (!canDouble(game, player)) return false;
  const chance = estimateWinChance(game.board, player);
  return chance >= DOUBLE_FLOOR && chance <= DOUBLE_CEILING;
}

export function shouldAcceptDouble(game: GameState, player: Player): boolean {
  const chance = estimateWinChance(game.board, player);
  return chance >= TAKE_FLOOR;
}
