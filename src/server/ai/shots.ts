/**
 * Shot counting: given a blot at `target`, how many of the 36 equally likely
 * dice rolls let `hitter` hit it right now.
 *
 * This is a heuristic support routine for the AI's board evaluation, not part
 * of the rules engine — it deliberately ignores the "maximal sequence" and
 * "must play both dice" rules (CLAUDE.md/engine CONTRACT.md), because a player
 * deciding whether a blot is dangerous cares about "could some legal path hit
 * it", not about whether every die must ultimately be spent. Re-deriving the
 * answer from `legalSequences` for all 36 rolls would also be far too slow to
 * run once per candidate move per blot.
 */

import {
  entryPoint,
  pointAt,
  type BoardState,
  type DieValue,
  type Player,
} from '../../engine';

function stepTowardHome(hitter: Player, point: number, die: DieValue): number {
  return hitter === 'white' ? point - die : point + die;
}

/** Open to a hitter's checker passing through or landing: not 2+ enemy checkers. */
function isOpenForHitter(board: BoardState, hitter: Player, point: number): boolean {
  if (point < 1 || point > 24) return false;
  const state = pointAt(board, point);
  return !(state.color !== null && state.color !== hitter && state.count >= 2);
}

function hitterPoints(board: BoardState, hitter: Player): number[] {
  const points: number[] = [];
  for (let p = 1; p <= 24; p += 1) {
    const state = board.points[p - 1];
    if (state && state.color === hitter && state.count > 0) points.push(p);
  }
  return points;
}

/**
 * Can a single checker starting at `origin` reach `target` using some
 * order/subset of the dice still in hand? Landing exactly on `target` always
 * counts as a hit regardless of remaining dice; passing through any other
 * point requires it to be open.
 */
function canReach(
  board: BoardState,
  hitter: Player,
  origin: number | 'bar',
  target: number,
  dice: readonly DieValue[],
): boolean {
  const tried = new Set<DieValue>();
  for (const die of dice) {
    if (tried.has(die)) continue;
    tried.add(die);

    const landing = origin === 'bar' ? entryPoint(hitter, die) : stepTowardHome(hitter, origin, die);
    if (landing < 1 || landing > 24) continue;
    if (landing === target) return true;
    if (!isOpenForHitter(board, hitter, landing)) continue;

    const rest = dice.slice();
    rest.splice(rest.indexOf(die), 1);
    if (rest.length > 0 && canReach(board, hitter, landing, target, rest)) return true;
  }
  return false;
}

/**
 * The 21 distinct rolls, each already expanded (doubles to four dice) and
 * carrying its weight out of 36. Exported so callers that need the union of
 * hitting rolls across SEVERAL blots can walk the same 36 outcomes once —
 * `countShots` answers for a single blot and its results cannot be added
 * together, because one roll that hits two blots is one shot, not two.
 */
export const DICE_ROLLS: readonly { readonly dice: readonly DieValue[]; readonly weight: number }[] =
  (() => {
    const rolls: { dice: readonly DieValue[]; weight: number }[] = [];
    for (let d1 = 1; d1 <= 6; d1 += 1) {
      for (let d2 = d1; d2 <= 6; d2 += 1) {
        const a = d1 as DieValue;
        const b = d2 as DieValue;
        rolls.push({ dice: d1 === d2 ? [a, a, a, a] : [a, b], weight: d1 === d2 ? 1 : 2 });
      }
    }
    return rolls;
  })();

export function canHitWithRoll(
  board: BoardState,
  hitter: Player,
  target: number,
  dice: readonly DieValue[],
): boolean {
  if (board.bar[hitter] > 0) {
    // Bar-first: the entering checker may itself continue toward the target...
    if (canReach(board, hitter, 'bar', target, dice)) return true;

    // ...or, after entering with one die, a DIFFERENT checker already on the
    // board may use what is left.
    const tried = new Set<DieValue>();
    for (const die of dice) {
      if (tried.has(die)) continue;
      tried.add(die);
      const entry = entryPoint(hitter, die);
      if (entry === target) return true;
      if (!isOpenForHitter(board, hitter, entry)) continue;

      const rest = dice.slice();
      rest.splice(rest.indexOf(die), 1);
      if (rest.length === 0) continue;
      for (const origin of hitterPoints(board, hitter)) {
        if (canReach(board, hitter, origin, target, rest)) return true;
      }
    }
    return false;
  }

  for (const origin of hitterPoints(board, hitter)) {
    if (canReach(board, hitter, origin, target, dice)) return true;
  }
  return false;
}

/**
 * Number of the 36 equally likely rolls (out of 36, not a fraction) that let
 * `hitter` hit a blot sitting at `target`.
 */
export function countShots(board: BoardState, hitter: Player, target: number): number {
  if (board.bar[hitter] === 0 && hitterPoints(board, hitter).length === 0) return 0;

  let shots = 0;
  for (const roll of DICE_ROLLS) {
    if (canHitWithRoll(board, hitter, target, roll.dice)) shots += roll.weight;
  }
  return shots;
}

/**
 * Number of the 36 rolls that hit AT LEAST ONE of `targets`. The union, not the
 * sum: a roll that hits two blots at once is one thing that can go wrong.
 */
export function countShotsAtAny(
  board: BoardState,
  hitter: Player,
  targets: readonly number[],
): number {
  if (targets.length === 0) return 0;
  if (board.bar[hitter] === 0 && hitterPoints(board, hitter).length === 0) return 0;

  let shots = 0;
  for (const roll of DICE_ROLLS) {
    if (targets.some((target) => canHitWithRoll(board, hitter, target, roll.dice))) {
      shots += roll.weight;
    }
  }
  return shots;
}
