/**
 * driver.ts - schedules and applies the computer's actions.
 *
 * These run against a real `RoomRegistry`, not a mock, so every action the
 * computer takes is re-validated by the actual engine exactly as a human's
 * would be (CLAUDE.md principle 1). Scripted dice make the outcome
 * deterministic; a synchronous scheduler removes real timers from the test.
 */
import { describe, expect, it } from 'vitest';

import { scriptedDice } from '../dice';
import { RoomRegistry } from '../rooms';
import { createComputerDriver, type Scheduler } from './driver';

const HUMAN = 'human-1';

/** Runs the scheduled step immediately, so a whole turn plays out in one call. */
const immediate: Scheduler = (run) => run();

describe('createComputerDriver', () => {
  it('auto-plays a full computer turn after winning the opening roll, landing back on the human', () => {
    // Human rolls 3, computer rolls 6 and so starts, playing 6 and 3.
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const room = registry.createVsComputerRoom(HUMAN, 'Human', 25);
    const startingBoard = room.game?.board;
    const driver = createComputerDriver(registry, () => undefined, { scheduler: immediate });

    registry.openingRoll(HUMAN);
    driver.poke(room.code);

    const after = registry.getRoom(room.code);
    expect(after?.game?.phase).toBe('awaiting-roll');
    expect(after?.game?.turn).toBe('white');
    expect(after?.game?.movesPlayed).toEqual([]);
    expect(after?.game?.board).not.toEqual(startingBoard);
  });

  it('is a no-op for a table with no computer seat', () => {
    const registry = new RoomRegistry(scriptedDice([3, 4]));
    registry.createRoom(HUMAN, 'Human', 25);
    const room = registry.findRoomForPlayer(HUMAN);
    if (!room) throw new Error('room was not created');

    let changed = false;
    const driver = createComputerDriver(registry, () => {
      changed = true;
    }, { scheduler: immediate });

    driver.poke(room.code);
    expect(changed).toBe(false);
  });

  it('is a no-op once the room no longer exists', () => {
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const driver = createComputerDriver(registry, () => undefined, { scheduler: immediate });
    expect(() => driver.poke('ZZZZZ')).not.toThrow();
  });

  it('waits for the scheduled delay rather than acting synchronously', () => {
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const room = registry.createVsComputerRoom(HUMAN, 'Human', 25);

    const captured: { run: (() => void) | null } = { run: null };
    const captureScheduler: Scheduler = (run) => {
      captured.run = run;
    };
    const driver = createComputerDriver(registry, () => undefined, { scheduler: captureScheduler });

    registry.openingRoll(HUMAN);
    driver.poke(room.code);

    // The computer's opening roll has been queued but not run yet.
    expect(registry.getRoom(room.code)?.game?.openingRolls.black).toBeUndefined();

    captured.run?.();
    expect(registry.getRoom(room.code)?.game?.openingRolls.black).toBe(6);
  });
});
