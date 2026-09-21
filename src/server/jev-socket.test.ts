/**
 * The Jev lane over a real socket, end to end.
 *
 * Boots an actual server with a stubbed TypeSafe client, so the whole path is
 * exercised — event handler, registry, both drivers, per-recipient snapshot —
 * without a network call or an API key. The two claims worth proving here are
 * the ones a unit test cannot: that starting the lane needs no share code and
 * seats nobody, and that a server with no key says so instead of opening a
 * table that can never decide anything.
 */
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';

import type {
  Ack,
  ClientToServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
} from '../shared/protocol';
import { scriptedDice } from './dice';
import { createServer, type AppServer } from './index';
import { RoomRegistry } from './rooms';
import { MOVE_QUESTION_ID } from './ai/jev/questions';
import type { Question, SystemOneResponse, TypeSafeClient } from './typesafe/client';

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

const servers: AppServer[] = [];
const clients: TestClient[] = [];

/** Picks the first option of whatever it is asked, which is always legal. */
function stubTypeSafe(configured = true): TypeSafeClient {
  return {
    configured,
    async ask(_state, questions: Readonly<Record<string, Question>>): Promise<SystemOneResponse> {
      const id = Object.keys(questions)[0] ?? MOVE_QUESTION_ID;
      const question = questions[id];
      const choice =
        question && question.type === 'choice' ? (Object.keys(question.criteria)[0] ?? 'roll') : 'roll';
      return {
        model: 'jev-test',
        answers: {
          [id]: { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 },
        },
      };
    },
  };
}

async function boot(typeSafe: TypeSafeClient): Promise<string> {
  const server = createServer(new RoomRegistry(scriptedDice([6, 3, 5, 2, 4, 1, 3, 6, 2, 5])), {
    computerDriver: { delayMs: 0 },
    typeSafe,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function openClient(url: string): Promise<TestClient> {
  const socket: TestClient = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('client connect timed out')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return socket;
}

function emit<T>(socket: TestClient, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timed out for ${event}`)), 5000);
    const done = (res: Ack<T>): void => {
      clearTimeout(timer);
      resolve(res);
    };
    if (payload === undefined) {
      (socket as unknown as { emit: (e: string, cb: unknown) => void }).emit(event, done);
    } else {
      (socket as unknown as { emit: (e: string, p: unknown, cb: unknown) => void }).emit(
        event,
        payload,
        done,
      );
    }
  });
}

function waitForSnapshot(
  socket: TestClient,
  predicate: (snap: RoomSnapshot) => boolean,
): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:snapshot', onSnap);
      reject(new Error('snapshot timed out'));
    }, 5000);
    const onSnap = (snap: RoomSnapshot): void => {
      if (!predicate(snap)) return;
      clearTimeout(timer);
      socket.off('room:snapshot', onSnap);
      resolve(snap);
    };
    socket.on('room:snapshot', onSnap);
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

describe('the Jev lane over a socket', () => {
  it('starts a table with no share code and no seat for the caller', async () => {
    const url = await boot(stubTypeSafe());
    const watcher = await openClient(url);

    const pending = waitForSnapshot(watcher, (s) => s.mode === 'jev-demo');
    const created = await emit<{ code: string }>(watcher, 'room:createJevDemo', {
      playerId: 'watcher',
      name: 'Watcher',
      stake: 25,
    });
    expect(created.ok).toBe(true);

    const snap = await pending;
    expect(snap.status).toBe('playing');
    // No seat: this is the whole reason the watcher cannot act.
    expect(snap.you).toBeNull();
    expect(snap.legalMoves).toEqual([]);
    expect(snap.canDouble).toBe(false);
    expect(snap.canEndTurn).toBe(false);
    // Jev is white, which is the seat the client renders at the bottom.
    expect(snap.seats.map((s) => [s.player, s.name, s.isJev])).toEqual([
      ['white', 'Jev', true],
      ['black', 'Computer', false],
    ]);
    expect(snap.jev).not.toBeNull();
  });

  it('plays itself and reports a structured decision to the watcher', async () => {
    const url = await boot(stubTypeSafe());
    const watcher = await openClient(url);

    const decided = waitForSnapshot(watcher, (s) => s.jev?.last != null);
    await emit(watcher, 'room:createJevDemo', {
      playerId: 'watcher',
      name: 'Watcher',
      stake: 25,
    });

    const snap = await decided;
    const decision = snap.jev?.last;
    expect(decision).toBeDefined();
    expect(decision?.source).toBe('jev');
    expect(decision?.confidence).toBeCloseTo(0.9);
    expect(decision?.choiceLabel.length).toBeGreaterThan(0);
    expect(decision?.options.length).toBeGreaterThan(0);
    // Probabilities are ordered strongest first for the panel.
    const probabilities = decision?.options.map((o) => o.probability) ?? [];
    expect([...probabilities].sort((a, b) => b - a)).toEqual(probabilities);
  });

  it('refuses a move from the watcher, who has no seat', async () => {
    const url = await boot(stubTypeSafe());
    const watcher = await openClient(url);
    await emit(watcher, 'room:createJevDemo', {
      playerId: 'watcher',
      name: 'Watcher',
      stake: 25,
    });

    const res = await emit(watcher, 'game:move', {
      move: { from: 24, to: 18, die: 6, hit: false },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not seated/i);
  });

  it('fails clearly when the server has no API key, opening no table', async () => {
    const url = await boot(stubTypeSafe(false));
    const watcher = await openClient(url);

    const res = await emit<{ code: string }>(watcher, 'room:createJevDemo', {
      playerId: 'watcher',
      name: 'Watcher',
      stake: 25,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/TYPESAFE_API_KEY/);
    expect(servers[0]?.registry.size).toBe(0);
  });

  it('leaves the vs-computer lane alone', async () => {
    const url = await boot(stubTypeSafe());
    const human = await openClient(url);

    const pending = waitForSnapshot(human, (s) => s.status === 'playing');
    const created = await emit<{ code: string }>(human, 'room:createVsComputer', {
      playerId: 'human',
      name: 'Human',
      stake: 25,
    });
    expect(created.ok).toBe(true);

    const snap = await pending;
    expect(snap.mode).toBe('vs-computer');
    expect(snap.you).toBe('white');
    expect(snap.jev).toBeNull();
    expect(snap.seats.some((s) => s.isJev)).toBe(false);
  });
});
