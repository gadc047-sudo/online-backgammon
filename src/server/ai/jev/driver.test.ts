/**
 * driver.ts — when Jev acts, and what happens to the room when it does.
 *
 * Like the heuristic driver's tests, these run against a real `RoomRegistry`
 * with scripted dice, so every action Jev takes is re-validated by the real
 * engine (CLAUDE.md principle 1). TypeSafe is a stub throughout: nothing here
 * touches the network, and the case that matters — "the option Jev chose is the
 * play that appears on the board" — is asserted against the board the registry
 * ends up holding, not against the driver's own bookkeeping.
 */
import { describe, expect, it, vi } from 'vitest';

import { canEndTurn, legalMovesNow, legalSequences } from '../../../engine';
import { scriptedDice } from '../../dice';
import { RoomRegistry, type Room } from '../../rooms';
import type { Question, SystemOneResponse, TypeSafeClient } from '../../typesafe/client';
import { createComputerDriver, type ComputerDriver } from '../driver';
import { applySequence, describeSequence } from './describe';
import { createJevDriver, type JevDriver } from './driver';
import { CUBE_OFFER_QUESTION_ID, CUBE_RESPONSE_QUESTION_ID, MOVE_QUESTION_ID } from './questions';

const WATCHER = 'watcher-1';

/** Runs the scheduled step immediately, so a turn plays out without timers. */
const immediate = (run: () => void): void => run();

type Picker = (id: string, questions: Readonly<Record<string, Question>>) => string;

function stubClient(pick: Picker): TypeSafeClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    configured: true,
    async ask(_state, questions): Promise<SystemOneResponse> {
      const id = Object.keys(questions)[0] ?? MOVE_QUESTION_ID;
      asked.push(id);
      const choice = pick(id, questions);
      return {
        model: 'jev-test',
        answers: {
          [id]: { type: 'choice', choice, probabilities: { [choice]: 0.84 }, confidence: 0.84 },
        },
      };
    },
  };
}

/** Always takes the first option offered. Deterministic and always legal. */
const firstOption: Picker = (id, questions) => {
  const question = questions[id];
  if (question && question.type === 'choice') return Object.keys(question.criteria)[0] ?? 'roll';
  return 'roll';
};

/** Never doubles, so a game is decided by play rather than by the cube. */
const neverDouble: Picker = (id, questions) =>
  id === CUBE_OFFER_QUESTION_ID ? 'roll' : firstOption(id, questions);

/**
 * Drains the driver. `poke` re-pokes itself after each step, but every step
 * that consults TypeSafe resolves on the microtask queue, so a test has to let
 * those settle before reading the room.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 500; i += 1) await Promise.resolve();
}

function seatIds(room: Room): { jevId: string; computerId: string } {
  const jev = room.seats.find((s) => s.isJev);
  const computer = room.seats.find((s) => !s.isJev);
  if (!jev || !computer) throw new Error('expected a Jev seat and a computer seat');
  return { jevId: jev.playerId, computerId: computer.playerId };
}

/**
 * A Jev table with BOTH drivers wired the way `socket.ts` wires them: every
 * change pokes each, and each only ever finds its own seat. Driving the Jev
 * driver alone would deadlock at the opening roll, because the black seat
 * belongs to the heuristic computer and nothing else would ever roll it.
 */
function jevTable(dice: number[], client: TypeSafeClient) {
  const registry = new RoomRegistry(scriptedDice(dice as never));
  const room = registry.createJevDemoRoom(WATCHER, 'Watcher', 25);
  const changes: Room[] = [];

  // Each driver's onChange has to reach the other, so they are held in a box
  // that both close over instead of referring to each other directly.
  const drivers: { computer?: ComputerDriver; jev?: JevDriver } = {};
  const broadcast = (r: Room): void => {
    changes.push(r);
    drivers.computer?.poke(r.code);
    drivers.jev?.poke(r.code);
  };
  drivers.computer = createComputerDriver(registry, broadcast, { scheduler: immediate });
  drivers.jev = createJevDriver(registry, client, broadcast, { scheduler: immediate });

  const jev = drivers.jev;
  const pokeAll = (): void => broadcast(room);

  return { registry, room, jev, pokeAll, changes };
}

/**
 * A Jev table with ONLY the Jev driver. Jev's turn runs and the table then
 * halts, because nothing drives black — which is what lets a test count API
 * calls against exactly one turn.
 */
function jevTurnOnly(dice: number[], client: TypeSafeClient) {
  const registry = new RoomRegistry(scriptedDice(dice as never));
  const room = registry.createJevDemoRoom(WATCHER, 'Watcher', 25);
  const { jevId, computerId } = seatIds(room);

  const jev: JevDriver = createJevDriver(registry, client, (r) => jev.poke(r.code), {
    scheduler: immediate,
  });

  return { registry, room, jev, jevId, computerId };
}

/**
 * Plays a seat's turn out through the registry, taking the first legal move
 * each time. Lets a test hand the turn back to Jev without wiring the computer
 * driver, which would otherwise carry the whole game past the assertion.
 */
function playOutTurn(registry: RoomRegistry, playerId: string): void {
  for (let guard = 0; guard < 8; guard += 1) {
    const game = registry.findRoomForPlayer(playerId)?.game;
    if (!game || game.phase !== 'moving') return;
    if (canEndTurn(game)) {
      registry.endTurn(playerId);
      return;
    }
    const move = legalMovesNow(game)[0];
    if (!move) return;
    registry.move(playerId, move);
  }
}

/** Opening settled by hand, so exactly one Jev turn is under test. */
function openedJevTurn(dice: number[], client: TypeSafeClient) {
  const table = jevTurnOnly(dice, client);
  table.registry.openingRoll(table.jevId);
  table.registry.openingRoll(table.computerId);
  return table;
}

describe('createJevDriver', () => {
  it('applies exactly the play Jev chose, through the engine', async () => {
    // Jev (white) rolls 6 for the opening, the computer rolls 3, so white
    // starts and plays 6 and 3.
    const client = stubClient(neverDouble);
    const { registry, room, jev } = openedJevTurn([6, 3], client);

    // The opening roll settles who starts; it does not move a checker, so this
    // is still the starting position.
    const openingBoard = room.game?.board;
    if (!openingBoard) throw new Error('expected a game in progress');

    jev.poke(room.code);
    await settle();

    const after = registry.getRoom(room.code);
    const decision = after?.jev.last;
    expect(decision).toBeDefined();
    expect(decision?.kind).toBe('move');
    expect(decision?.source).toBe('jev');
    expect(decision?.confidence).toBeCloseTo(0.84);

    // Independently re-derive what the chosen option meant, and check the board
    // the registry ended up holding is exactly the board that play produces.
    // This is the claim worth making: the option Jev named came out of the
    // engine's own legal set, and it is the position that actually happened.
    const chosen = legalSequences(openingBoard, 'white', [6, 3]).find(
      (sequence) => describeSequence(sequence) === decision?.choiceLabel,
    );
    expect(chosen).toBeDefined();
    if (!chosen) throw new Error('unreachable');
    expect(after?.game?.board).toEqual(applySequence(openingBoard, 'white', chosen));
  });

  it('leaves fifteen checkers a side however the play was chosen', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = openedJevTurn([6, 3], client);

    jev.poke(room.code);
    await settle();

    const board = registry.getRoom(room.code)?.game?.board;
    expect(board).toBeDefined();
    const count = (colour: 'white' | 'black'): number => {
      if (!board) return -1;
      let n = board.bar[colour] + board.off[colour];
      for (const point of board.points) if (point.color === colour) n += point.count;
      return n;
    };
    expect(count('white')).toBe(15);
    expect(count('black')).toBe(15);
  });

  it('records a fallback decision and keeps playing when TypeSafe fails', async () => {
    const client: TypeSafeClient = {
      configured: true,
      ask: vi.fn(async () => {
        throw new Error('TypeSafe is down.');
      }),
    };
    const { registry, room, jevId, computerId, jev } = jevTurnOnly([6, 3], client);
    registry.openingRoll(jevId);
    registry.openingRoll(computerId);

    jev.poke(room.code);
    await settle();

    const after = registry.getRoom(room.code);
    expect(after?.jev.last?.source).toBe('fallback');
    expect(after?.jev.error).toBe('TypeSafe is down.');
    expect(after?.jev.thinking).toBe(false);
    // The turn still resolved: the room did not stall on the failed call.
    expect(after?.game?.phase).not.toBe('opening-roll');
  });

  it('clears the thinking flag once a decision lands', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = openedJevTurn([6, 3], client);

    jev.poke(room.code);
    await settle();

    expect(registry.getRoom(room.code)?.jev.thinking).toBe(false);
  });

  it('does nothing at a table nobody is watching', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = jevTable([6, 3], client);
    registry.markDisconnected(WATCHER);

    jev.poke(room.code);
    await settle();

    expect(registry.getRoom(room.code)?.game?.openingRolls.white).toBeUndefined();
    expect(client.asked).toHaveLength(0);
  });

  it('resumes when the watcher comes back', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = jevTable([6, 3], client);
    registry.markDisconnected(WATCHER);
    jev.poke(room.code);
    await settle();

    registry.joinRoom(room.code, WATCHER, 'Watcher');
    jev.poke(room.code);
    await settle();

    expect(registry.getRoom(room.code)?.game?.openingRolls.white).toBe(6);
  });

  it('is a no-op on a table with no Jev seat', async () => {
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const room = registry.createVsComputerRoom('human-1', 'Human', 25);
    const client = stubClient(neverDouble);
    const jev = createJevDriver(registry, client, () => undefined, { scheduler: immediate });

    jev.poke(room.code);
    await settle();

    expect(client.asked).toHaveLength(0);
  });

  it('is a no-op once the room is gone', () => {
    const client = stubClient(neverDouble);
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const jev = createJevDriver(registry, client, () => undefined, { scheduler: immediate });
    expect(() => jev.poke('ZZZZZ')).not.toThrow();
  });

  it('asks once per turn, not once per hop of a multi-hop play', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = openedJevTurn([6, 3], client);

    jev.poke(room.code);
    await settle();

    const after = registry.getRoom(room.code);
    // White won the opening and played both dice: two hops, one decision.
    expect(after?.game?.turn).toBe('black');
    expect(client.asked.filter((id) => id === MOVE_QUESTION_ID)).toHaveLength(1);
    expect(after?.log.filter((e) => e.text.startsWith('Jev plays'))).toHaveLength(1);
  });

  it('offers the double when Jev says double, asking the cube once', async () => {
    const client = stubClient((id, questions) =>
      id === CUBE_OFFER_QUESTION_ID ? 'double' : firstOption(id, questions),
    );
    // Black wins the opening (3 vs 6) and plays first, so the next turn is
    // Jev's own `awaiting-roll` — where the cube question applies.
    const { registry, room, jev, computerId } = openedJevTurn([3, 6], client);
    playOutTurn(registry, computerId);

    jev.poke(room.code);
    await settle();

    expect(client.asked.filter((id) => id === CUBE_OFFER_QUESTION_ID)).toHaveLength(1);
    const after = registry.getRoom(room.code);
    expect(after?.game?.phase).toBe('cube-offered');
    expect(after?.jev.last?.kind).toBe('cube-offer');
    expect(after?.jev.last?.choiceLabel).toBe('Double');
  });

  it('rolls on without re-asking when Jev declines the cube', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev, computerId } = openedJevTurn([3, 6], client);
    playOutTurn(registry, computerId);

    jev.poke(room.code);
    await settle();

    // Declining must not leave the driver asking the same question forever.
    expect(client.asked.filter((id) => id === CUBE_OFFER_QUESTION_ID)).toHaveLength(1);
    expect(registry.getRoom(room.code)?.game?.cube.value).toBe(1);
    expect(registry.getRoom(room.code)?.game?.turn).toBe('black');
  });

  it('answers a double offered to it', async () => {
    const client = stubClient((id, questions) =>
      id === CUBE_RESPONSE_QUESTION_ID ? 'take' : firstOption(id, questions),
    );
    // Jev wins the opening (6 vs 3) and plays; black then doubles before its
    // own roll, which is the only moment a double can be offered to Jev.
    const { registry, room, jev, computerId } = openedJevTurn([6, 3], client);
    jev.poke(room.code);
    await settle();
    expect(registry.getRoom(room.code)?.game?.turn).toBe('black');
    registry.offerDouble(computerId);

    jev.poke(room.code);
    await settle();

    const after = registry.getRoom(room.code);
    expect(client.asked).toContain(CUBE_RESPONSE_QUESTION_ID);
    expect(after?.game?.cube.value).toBe(2);
    expect(after?.game?.cube.owner).toBe('white');
    expect(after?.jev.last?.kind).toBe('cube-response');
    expect(after?.jev.last?.choiceLabel).toBe('Take');
  });

  it('writes each decision into the room log with its confidence', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, jev } = openedJevTurn([6, 3], client);

    jev.poke(room.code);
    await settle();

    const logged = registry
      .getRoom(room.code)
      ?.log.filter((entry) => entry.text.startsWith('Jev plays'));
    expect(logged?.length).toBeGreaterThan(0);
    expect(logged?.[0]?.text).toMatch(/confidence 0\.84/);
  });
});

describe('a Jev table plays without a person acting on it', () => {
  it('rolls both openings with no input from the watcher', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, pokeAll } = jevTable([6, 3, 4, 2, 5, 1], client);

    pokeAll();
    await settle();

    const game = registry.getRoom(room.code)?.game;
    expect(game?.openingRolls.white).toBe(6);
    expect(game?.openingRolls.black).toBe(3);
    expect(game?.phase).not.toBe('opening-roll');
  });

  it('refuses every game action from the watcher, who has no seat', () => {
    const client = stubClient(neverDouble);
    const { registry } = jevTable([6, 3], client);

    expect(() => registry.openingRoll(WATCHER)).toThrow(/not seated/);
    expect(() => registry.roll(WATCHER)).toThrow(/not seated/);
    expect(() => registry.endTurn(WATCHER)).toThrow(/not seated/);
    expect(() => registry.offerDouble(WATCHER)).toThrow(/not seated/);
    expect(() => registry.undo(WATCHER)).toThrow(/not seated/);
    expect(() => registry.resign(WATCHER)).toThrow(/not seated/);
  });

  it('will not let the watcher restart a game that is still running', () => {
    const client = stubClient(neverDouble);
    const { registry } = jevTable([6, 3], client);
    expect(() => registry.rematch(WATCHER)).toThrow(/still running/);
  });

  it('does not restart itself when the game ends', async () => {
    const client = stubClient(neverDouble);
    const { registry, room, pokeAll } = jevTable([6, 3], client);
    const { jevId } = seatIds(room);
    registry.resign(jevId);

    pokeAll();
    await settle();

    const after = registry.getRoom(room.code);
    expect(after?.status).toBe('game-over');
    expect(after?.rematchRequests.size).toBe(0);
    expect(after?.game?.phase).toBe('game-over');
  });

  it('lets the watcher start the next game once this one is over', () => {
    const client = stubClient(neverDouble);
    const { registry, room, jevId } = jevTurnOnly([6, 3], client);
    registry.resign(jevId);
    expect(registry.getRoom(room.code)?.status).toBe('game-over');

    const restarted = registry.rematch(WATCHER);
    expect(restarted.status).toBe('playing');
    expect(restarted.game?.phase).toBe('opening-roll');
    expect(restarted.jev.last).toBeNull();
  });
});
