import { randomInt } from 'node:crypto';

import type { DieValue } from '../engine/types';

/**
 * Dice are generated here and nowhere else.
 *
 * CLAUDE.md principle 1: a client that can influence its own rolls breaks a
 * betting game outright, even a play-money one. `crypto.randomInt` is a CSPRNG
 * and is uniform over the requested range; `Math.random` is neither and must
 * never appear in this file.
 */
export interface DiceSource {
  rollDie(): DieValue;
  rollDice(): [DieValue, DieValue];
}

/** `randomInt(1, 7)` is inclusive of 1 and exclusive of 7, so it yields 1..6. */
function secureDie(): DieValue {
  return randomInt(1, 7) as DieValue;
}

export const cryptoDice: DiceSource = {
  rollDie: secureDie,
  rollDice: () => [secureDie(), secureDie()],
};

/**
 * Deterministic dice for tests only. Never wired into the running server.
 * Cycles through the supplied values so a test can script an entire game.
 */
export function scriptedDice(values: readonly DieValue[]): DiceSource {
  if (values.length === 0) throw new Error('scriptedDice needs at least one value');
  let i = 0;
  const next = (): DieValue => {
    const v = values[i % values.length];
    i += 1;
    // `values` is non-empty and the modulo keeps us in range, but
    // noUncheckedIndexedAccess cannot see that.
    return v ?? 1;
  };
  return {
    rollDie: next,
    rollDice: () => [next(), next()],
  };
}
