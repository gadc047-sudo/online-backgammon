/**
 * Legal move generation.
 *
 * The whole turn is enumerated at once from the turn-start board, never hop by
 * hop, because "play both dice if you can", "play the higher die if only one is
 * playable" and the bear-off overshoot rule are all properties of the COMPLETE
 * turn. Validating a single hop in isolation cannot see them.
 */

import {
  IllegalMoveError,
  type BoardState,
  type DieValue,
  type Move,
  type Player,
} from './types';
import {
  allCheckersHome,
  applyMoveToBoard,
  boardKey,
  distanceToOff,
  entryPoint,
  isBlocked,
  pointAt,
} from './board';

const POINT_COUNT = 24;

export function expandDice(roll: readonly [DieValue, DieValue]): DieValue[] {
  const [a, b] = roll;
  return a === b ? [a, a, a, a] : [a, b];
}

function opponentColor(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

/** Distance of the player's checker that sits farthest from home; 0 if none. */
function farthestDistance(board: BoardState, player: Player): number {
  if (board.bar[player] > 0) return 25;
  let farthest = 0;
  for (let point = 1; point <= POINT_COUNT; point += 1) {
    const state = board.points[point - 1];
    if (!state || state.color !== player || state.count === 0) continue;
    const distance = distanceToOff(player, point);
    if (distance > farthest) farthest = distance;
  }
  return farthest;
}

/** Every single hop available with one die from this exact position. */
function singleMoves(board: BoardState, player: Player, die: DieValue): Move[] {
  const moves: Move[] = [];
  const foe = opponentColor(player);

  // Bar first: nothing else is legal while a checker is off the board.
  if (board.bar[player] > 0) {
    const target = entryPoint(player, die);
    if (!isBlocked(board, player, target)) {
      const dest = pointAt(board, target);
      moves.push({
        from: 'bar',
        to: target,
        die,
        hit: dest.color === foe && dest.count === 1,
      });
    }
    return moves;
  }

  const bearingOff = allCheckersHome(board, player);
  const farthest = bearingOff ? farthestDistance(board, player) : 0;

  for (let point = 1; point <= POINT_COUNT; point += 1) {
    const state = board.points[point - 1];
    if (!state || state.color !== player || state.count === 0) continue;

    const fromDistance = distanceToOff(player, point);
    const toDistance = fromDistance - die;

    if (toDistance > 0) {
      const target = player === 'white' ? point - die : point + die;
      if (!isBlocked(board, player, target)) {
        const dest = pointAt(board, target);
        moves.push({
          from: point,
          to: target,
          die,
          hit: dest.color === foe && dest.count === 1,
        });
      }
      continue;
    }

    // Bearing off. An exact die always works; an oversized die works only when
    // no checker of ours sits farther from home than this one. An undersized
    // die never bears off - it is handled by the branch above.
    if (bearingOff && (toDistance === 0 || fromDistance === farthest)) {
      moves.push({ from: point, to: 'off', die, hit: false });
    }
  }

  return moves;
}

/** Hops of a play held front-to-back as a shared linked list, so a memoised */
/** sub-result can be reused by many parents without copying its hops. */
interface Chain {
  readonly move: Move;
  readonly next: Chain | null;
}

/**
 * A complete play plus the canonical key of the board it produces. That key is
 * how permutations of the same play get collapsed: same start board, same end
 * board and same hop count means the same play.
 */
interface Play {
  readonly chain: Chain | null;
  readonly length: number;
  readonly endKey: string;
}

function playToMoves(play: Play): Move[] {
  const moves = new Array<Move>(play.length);
  let node = play.chain;
  let index = 0;
  while (node !== null) {
    moves[index] = node.move;
    index += 1;
    node = node.next;
  }
  return moves;
}

function removeOne(dice: readonly DieValue[], die: DieValue): DieValue[] {
  const rest = dice.slice();
  const index = rest.indexOf(die);
  if (index >= 0) rest.splice(index, 1);
  return rest;
}

function distinctDice(dice: readonly DieValue[]): DieValue[] {
  const distinct: DieValue[] = [];
  for (const die of dice) {
    if (!distinct.includes(die)) distinct.push(die);
  }
  return distinct;
}

function diceKey(dice: readonly DieValue[]): string {
  return dice
    .slice()
    .sort((a, b) => a - b)
    .join('');
}

/**
 * Depth-first search returning only the LONGEST plays reachable from `board`
 * with `remaining` dice. Memoised on (position, remaining-dice multiset) -
 * without that, doubles explode combinatorially, because four identical dice
 * generate every ordering of the same set of hops.
 */
function searchMaximal(
  board: BoardState,
  player: Player,
  remaining: readonly DieValue[],
  memo: Map<string, Play[]>,
): Play[] {
  const positionKey = boardKey(board);
  if (remaining.length === 0) {
    return [{ chain: null, length: 0, endKey: positionKey }];
  }

  const memoKey = `${positionKey}#${diceKey(remaining)}`;
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;

  let best = 0;
  const byEndPosition = new Map<string, Play>();

  for (const die of distinctDice(remaining)) {
    const rest = removeOne(remaining, die);
    for (const move of singleMoves(board, player, die)) {
      const next = applyMoveToBoard(board, player, move);
      for (const tail of searchMaximal(next, player, rest, memo)) {
        const length = tail.length + 1;
        if (length < best) continue;
        if (length > best) {
          best = length;
          byEndPosition.clear();
        }
        // tail.endKey is already the key of the board after move plus tail.
        if (!byEndPosition.has(tail.endKey)) {
          byEndPosition.set(tail.endKey, {
            chain: { move, next: tail.chain },
            length,
            endKey: tail.endKey,
          });
        }
      }
    }
  }

  const result: Play[] =
    best === 0
      ? [{ chain: null, length: 0, endKey: positionKey }]
      : [...byEndPosition.values()];
  memo.set(memoKey, result);
  return result;
}

function isDoubles(dice: readonly DieValue[]): boolean {
  const first = dice[0];
  if (first === undefined || dice.length < 2) return false;
  return dice.every((die) => die === first);
}

function highestDie(dice: readonly DieValue[]): DieValue | undefined {
  let highest: DieValue | undefined;
  for (const die of dice) {
    if (highest === undefined || die > highest) highest = die;
  }
  return highest;
}

export function legalSequences(
  board: BoardState,
  player: Player,
  dice: readonly DieValue[],
): Move[][] {
  if (dice.length === 0) return [[]];

  const plays = searchMaximal(board, player, dice, new Map<string, Play[]>());
  let sequences = plays.map(playToMoves);

  // Every play returned by the search already has the maximal length L.
  const length = sequences[0]?.length ?? 0;
  // Completely blocked: one empty sequence, never an empty list.
  if (length === 0) return [[]];

  // Higher-die rule. Only bites when exactly one die can be played at all.
  if (length === 1 && !isDoubles(dice)) {
    const higher = highestDie(dice);
    const usingHigher = sequences.filter((sequence) => sequence[0]?.die === higher);
    if (usingHigher.length > 0) sequences = usingHigher;
  }

  return sequences;
}

function sameHop(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.die === b.die;
}

function hopKey(move: Move): string {
  return `${String(move.from)}>${String(move.to)}:${move.die}`;
}

/**
 * Longest play reachable from here, as a count of hops. Memoised on
 * (position, remaining-dice multiset), which is what keeps doubles tractable.
 */
function maxPlayLength(
  board: BoardState,
  player: Player,
  remaining: readonly DieValue[],
  memo: Map<string, number>,
): number {
  if (remaining.length === 0) return 0;

  const memoKey = `${boardKey(board)}#${diceKey(remaining)}`;
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;

  let best = 0;
  outer: for (const die of distinctDice(remaining)) {
    const rest = removeOne(remaining, die);
    for (const move of singleMoves(board, player, die)) {
      const next = applyMoveToBoard(board, player, move);
      const length = 1 + maxPlayLength(next, player, rest, memo);
      if (length > best) best = length;
      // Nothing can beat using every die still in hand.
      if (best === remaining.length) break outer;
    }
  }

  memo.set(memoKey, best);
  return best;
}

/**
 * Hops playable right now that still keep the turn on track to use `needed`
 * more dice in total.
 *
 * This is deliberately NOT derived from `legalSequences`. That function collapses
 * permutations which reach the same board into a single representative play, so
 * prefix-filtering its output would silently forbid legal hops purely because
 * some other ordering was chosen as the representative. Asking "can this hop
 * still reach the maximum?" is order-independent, so it cannot lose a move.
 */
function continuationsFrom(
  board: BoardState,
  player: Player,
  remaining: readonly DieValue[],
  needed: number,
  memo: Map<string, number>,
): Move[] {
  if (needed <= 0) return [];

  const next: Move[] = [];
  const seen = new Set<string>();
  for (const die of distinctDice(remaining)) {
    const rest = removeOne(remaining, die);
    for (const move of singleMoves(board, player, die)) {
      const after = applyMoveToBoard(board, player, move);
      if (1 + maxPlayLength(after, player, rest, memo) !== needed) continue;
      const key = hopKey(move);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(move);
    }
  }
  return next;
}

/**
 * The higher-die rule only bites at the very start of a turn, and only when a
 * single die is all that can be played at all.
 */
function restrictToHigherDie(
  moves: Move[],
  dice: readonly DieValue[],
  totalLength: number,
  movesAlreadyPlayed: number,
): Move[] {
  if (movesAlreadyPlayed !== 0 || totalLength !== 1 || isDoubles(dice)) return moves;
  const higher = highestDie(dice);
  const usingHigher = moves.filter((move) => move.die === higher);
  return usingHigher.length > 0 ? usingHigher : moves;
}

export function legalContinuations(
  board: BoardState,
  player: Player,
  dice: readonly DieValue[],
  movesPlayed: readonly Move[],
): Move[] {
  if (dice.length === 0) {
    if (movesPlayed.length > 0) {
      throw new IllegalMoveError('The moves played so far are not the prefix of any legal sequence.');
    }
    return [];
  }

  const memo = new Map<string, number>();
  const totalLength = maxPlayLength(board, player, dice, memo);

  // Replay the prefix, checking each hop against what was legal at that point.
  let current = board;
  let remaining: DieValue[] = dice.slice();
  let needed = totalLength;

  for (let i = 0; i < movesPlayed.length; i += 1) {
    const played = movesPlayed[i];
    const options = restrictToHigherDie(
      continuationsFrom(current, player, remaining, needed, memo),
      dice,
      totalLength,
      i,
    );
    const match = played && options.find((option) => sameHop(option, played));
    if (!match) {
      throw new IllegalMoveError(
        'The moves played so far are not the prefix of any legal sequence.',
      );
    }
    current = applyMoveToBoard(current, player, match);
    remaining = removeOne(remaining, match.die);
    needed -= 1;
  }

  return restrictToHigherDie(
    continuationsFrom(current, player, remaining, needed, memo),
    dice,
    totalLength,
    movesPlayed.length,
  );
}

export function isSequenceComplete(
  board: BoardState,
  player: Player,
  dice: readonly DieValue[],
  movesPlayed: readonly Move[],
): boolean {
  return legalContinuations(board, player, dice, movesPlayed).length === 0;
}
