/**
 * Heuristic board evaluation for the computer opponent.
 *
 * This is intentionally NOT a rollout or a neural net — it is a weighted sum
 * of the handful of features intermediate players actually look at: the race
 * (pip count), blot exposure (shots the opponent has at each of our blots,
 * and vice versa), board structure (made points, primes), anchors in the
 * opponent's home board, and bearing-off progress. Higher is better for
 * `player`. Symmetric: `evaluateBoard(board, p) === -evaluateBoard(board, opponentOf(p))`.
 */

import { distanceToOff, pipCount, type BoardState, type Player } from '../../engine';
import { countShots } from './shots';

function opponentOf(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

/** Pips lost by being sent to the bar from `point` — 25 (the bar) minus what was left to go. */
function hitCost(owner: Player, point: number): number {
  return 25 - distanceToOff(owner, point);
}

const BLOT_RISK_WEIGHT = 1.15;
const BAR_PENALTY = 3;
const BEAR_OFF_BONUS = 4;
const MADE_POINT_BONUS = 3;
const HOME_BLOCK_BONUS = 2;
const PRIME_BONUS_PER_EXTRA = 4;
const ANCHOR_BONUS = 5;

/**
 * Made points, primes (runs of consecutive made points), and points made deep
 * in the opponent's home board that restrict their escape.
 */
function structureScore(board: BoardState, player: Player): number {
  const opponent = opponentOf(player);
  const opponentHome = opponent === 'white' ? [1, 2, 3, 4, 5, 6] : [19, 20, 21, 22, 23, 24];

  let score = 0;
  let run = 0;
  let bestRun = 0;

  // Points are walked in a fixed absolute order; a "run" of consecutive made
  // points is a prime regardless of which direction the player travels.
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    const made = state !== undefined && state.color === player && state.count >= 2;
    if (made) {
      score += MADE_POINT_BONUS;
      if (opponentHome.includes(p)) score += HOME_BLOCK_BONUS;
      run += 1;
      if (run > bestRun) bestRun = run;
    } else {
      run = 0;
    }
  }

  if (bestRun >= 2) score += (bestRun - 1) * PRIME_BONUS_PER_EXTRA;
  return score;
}

/** Own checkers (2+) anchored in the opponent's home board: a safe base to sit on. */
function anchorScore(board: BoardState, player: Player): number {
  const opponent = opponentOf(player);
  const opponentHome = opponent === 'white' ? [1, 2, 3, 4, 5, 6] : [19, 20, 21, 22, 23, 24];
  let score = 0;
  for (const p of opponentHome) {
    const state = board.points[p - 1];
    if (state && state.color === player && state.count >= 2) score += ANCHOR_BONUS;
  }
  return score;
}

/**
 * Net blot exposure across the whole board: penalise our blots by the pips we
 * stand to lose weighted by how likely the opponent is to hit them, and
 * credit the opponent's blots the same way.
 */
function blotScore(board: BoardState, player: Player): number {
  const opponent = opponentOf(player);
  let score = 0;
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (!state || state.count !== 1) continue;

    if (state.color === player) {
      const shots = countShots(board, opponent, p);
      score -= (shots / 36) * hitCost(player, p) * BLOT_RISK_WEIGHT;
    } else if (state.color === opponent) {
      const shots = countShots(board, player, p);
      score += (shots / 36) * hitCost(opponent, p) * BLOT_RISK_WEIGHT;
    }
  }
  return score;
}

export function evaluateBoard(board: BoardState, player: Player): number {
  const opponent = opponentOf(player);
  let score = 0;

  // Race.
  score += pipCount(board, opponent) - pipCount(board, player);
  score += (board.off[player] - board.off[opponent]) * BEAR_OFF_BONUS;
  score -= board.bar[player] * BAR_PENALTY;
  score += board.bar[opponent] * BAR_PENALTY;

  // Safety and structure.
  score += blotScore(board, player);
  score += structureScore(board, player) - structureScore(board, opponent);
  score += anchorScore(board, player) - anchorScore(board, opponent);

  return score;
}
