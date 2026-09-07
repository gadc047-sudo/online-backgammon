/**
 * Schedules and applies the computer opponent's actions after every change to
 * a room, so a human's own action always finishes settling before the
 * computer visibly reacts. Every action the computer takes runs through the
 * exact same `RoomRegistry` methods a human's action would (CLAUDE.md
 * principle 1) — this module only decides *when* to call them, never
 * *whether* they are legal. That validation still happens inside the engine,
 * exactly once, for both kinds of player.
 */

import { nextComputerAction, type ComputerAction } from './nextAction';
import type { Room, RoomRegistry } from '../rooms';

export type Scheduler = (run: () => void, delayMs: number) => void;

/** Feels like someone taking their turn without dragging the game out. */
export const DEFAULT_COMPUTER_DELAY_MS = 650;

const defaultScheduler: Scheduler = (run, delayMs) => {
  setTimeout(run, delayMs);
};

export interface ComputerDriver {
  /**
   * Check whether the computer seated at `code` has something to do next and,
   * if so, do it after the configured delay, then check again. A no-op when
   * the room has no computer seat or there is nothing for it to do right now.
   */
  poke(code: string): void;
}

export interface ComputerDriverOptions {
  readonly delayMs?: number;
  readonly scheduler?: Scheduler;
}

export function createComputerDriver(
  registry: RoomRegistry,
  onChange: (room: Room) => void,
  options: ComputerDriverOptions = {},
): ComputerDriver {
  const delayMs = options.delayMs ?? DEFAULT_COMPUTER_DELAY_MS;
  const scheduler = options.scheduler ?? defaultScheduler;

  function poke(code: string): void {
    const room = registry.getRoom(code);
    if (!room) return;
    const computerSeat = room.seats.find((s) => s.isComputer);
    if (!computerSeat) return;

    const action = nextComputerAction(
      { status: room.status, game: room.game, rematchRequestedBy: [...room.rematchRequests] },
      computerSeat.player,
    );
    if (!action) return;

    scheduler(() => {
      const stillThere = registry.getRoom(code);
      const stillComputer = stillThere?.seats.find((s) => s.isComputer);
      if (!stillThere || !stillComputer) return;

      let after: Room;
      try {
        after = applyAction(registry, stillComputer.playerId, action);
      } catch {
        // Defensive only: a human action could race this scheduled step (say,
        // answering a cube offer before this fires) and make `action` stale.
        // Drop it — the human's own action already triggered a fresh `poke`.
        return;
      }

      onChange(after);
      poke(code);
    }, delayMs);
  }

  return { poke };
}

function applyAction(registry: RoomRegistry, computerId: string, action: ComputerAction): Room {
  switch (action.type) {
    case 'openingRoll':
      return registry.openingRoll(computerId);
    case 'roll':
      return registry.roll(computerId);
    case 'offerDouble':
      return registry.offerDouble(computerId);
    case 'move':
      return registry.move(computerId, action.move);
    case 'endTurn':
      return registry.endTurn(computerId);
    case 'respondToDouble':
      return registry.respondToDouble(computerId, action.accept);
    case 'rematch':
      return registry.rematch(computerId);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled computer action ${JSON.stringify(unreachable)}`);
    }
  }
}
