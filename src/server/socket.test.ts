import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';

import type { Move } from '../engine/types';
import type {
  Ack,
  ClientToServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
} from '../shared/protocol';
import { createServer, type AppServer } from './index';
import { RoomRegistry } from './rooms';
import { scriptedDice } from './dice';

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: AppServer;
let url: string;
const clients: TestClient[] = [];

/** Opens a client and waits until it is actually connected. */
async function openClient(): Promise<TestClient> {
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

/** Emits and resolves with the server's ack, so tests can assert on failures. */
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

/** Resolves with the next snapshot this client receives. */
function nextSnapshot(socket: TestClient): Promise<RoomSnapshot> {
  return waitForSnapshot(socket, () => true);
}

/**
 * Resolves with the first snapshot satisfying `predicate`. Snapshots are pushed
 * on every state change, so a test that cares about one particular transition
 * must filter rather than assume it is next in line.
 */
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

beforeEach(async () => {
  // Fixed dice keep the opening roll decisive on the first try: 6 then 3.
  server = createServer(new RoomRegistry(scriptedDice([6, 3, 5, 2, 4, 1, 3, 6, 2, 5])));
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server.close();
});

describe('socket wiring', () => {
  it('creates and joins a table, then pushes a snapshot to both players', async () => {
    const alice = await openClient();
    const created = await emit<{ code: string }>(alice, 'room:create', {
      playerId: 'alice',
      name: 'Alice',
      stake: 25,
    });
    expect(created.ok).toBe(true);
    const code = created.data?.code;
    expect(code).toHaveLength(5);

    const bob = await openClient();
    const aliceSnap = nextSnapshot(alice);
    const joined = await emit<{ code: string }>(bob, 'room:join', {
      playerId: 'bob',
      name: 'Bob',
      code,
    });
    expect(joined.ok).toBe(true);

    const snap = await aliceSnap;
    expect(snap.you).toBe('white');
    expect(snap.status).toBe('playing');
    expect(snap.seats).toHaveLength(2);
    expect(snap.game?.phase).toBe('opening-roll');
  });

  it('rejects a join with an unknown code without changing state', async () => {
    const bob = await openClient();
    const res = await emit(bob, 'room:join', { playerId: 'bob', name: 'Bob', code: 'ZZZZZ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no table/i);
    expect(server.registry.size).toBe(0);
  });

  it('plays an opening roll and rejects an illegal move over the wire', async () => {
    const alice = await openClient();
    const created = await emit<{ code: string }>(alice, 'room:create', {
      playerId: 'alice',
      name: 'Alice',
      stake: 25,
    });
    const code = created.data?.code;

    const bob = await openClient();
    await emit(bob, 'room:join', { playerId: 'bob', name: 'Bob', code });

    await emit(alice, 'game:openingRoll');
    const settled = waitForSnapshot(alice, (v) => v.game?.phase === 'moving');
    await emit(bob, 'game:openingRoll');
    const snap = await settled;

    // Alice rolled 6, Bob rolled 3, so white leads with 6 and 3.
    expect(snap.game?.phase).toBe('moving');
    expect(snap.game?.turn).toBe('white');
    expect(snap.legalMoves.length).toBeGreaterThan(0);
    expect(snap.canEndTurn).toBe(false);

    const nonsense: Move = { from: 2, to: 1, die: 1, hit: false };
    const rejected = await emit(alice, 'game:move', { move: nonsense });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toBeTruthy();

    // And the off-turn player is refused outright.
    const offTurn = await emit(bob, 'game:move', { move: snap.legalMoves[0] as Move });
    expect(offTurn.ok).toBe(false);
    expect(offTurn.error).toMatch(/not your turn/i);
  });

  it('holds the seat across a disconnect and resyncs by full snapshot on rejoin', async () => {
    const alice = await openClient();
    const created = await emit<{ code: string }>(alice, 'room:create', {
      playerId: 'alice',
      name: 'Alice',
      stake: 25,
    });
    const code = created.data?.code;

    const bob = await openClient();
    await emit(bob, 'room:join', { playerId: 'bob', name: 'Bob', code });
    await emit(alice, 'game:openingRoll');
    await emit(bob, 'game:openingRoll');

    // Bob's browser goes away, exactly as a backgrounded mobile tab would.
    const aliceSeesDrop = waitForSnapshot(
      alice,
      (v) => v.seats.find((s) => s.player === 'black')?.connected === false,
    );
    bob.disconnect();
    const dropped = await aliceSeesDrop;
    expect(dropped.seats.find((s) => s.player === 'black')?.connected).toBe(false);
    expect(dropped.status).toBe('playing');
    expect(dropped.game).not.toBeNull();

    // Bob comes back with the same playerId and gets the live game, not a new one.
    const bobAgain = await openClient();
    const resync = waitForSnapshot(bobAgain, (v) => v.you === 'black');
    const rejoined = await emit(bobAgain, 'room:join', {
      playerId: 'bob',
      name: 'Bob',
      code,
    });
    expect(rejoined.ok).toBe(true);

    const snap = await resync;
    expect(snap.you).toBe('black');
    expect(snap.game?.phase).toBe('moving');
    expect(snap.seats.find((s) => s.player === 'black')?.connected).toBe(true);
  });

  it('does not report a phantom disconnect when a duplicate tab closes', async () => {
    // A second tab of the same profile shares localStorage, so it presents the
    // SAME playerId. Closing it must not tell the opponent that the player left.
    const alice = await openClient();
    const created = await emit<{ code: string }>(alice, 'room:create', {
      playerId: 'alice',
      name: 'Alice',
      stake: 25,
    });
    const code = created.data?.code;

    const bob = await openClient();
    await emit(bob, 'room:join', { playerId: 'bob', name: 'Bob', code });

    // Alice opens a duplicate tab, then closes it again.
    const aliceDuplicate = await openClient();
    await emit(aliceDuplicate, 'room:join', { playerId: 'alice', name: 'Alice', code });
    const settled = waitForSnapshot(bob, (v) => v.seats.length === 2);
    aliceDuplicate.disconnect();
    await settled;

    // Give the server a moment to process the disconnect, then assert Alice is
    // still seated and still shown as present.
    await new Promise((r) => setTimeout(r, 150));
    const room = server.registry.getRoom(code as string);
    expect(room?.seats.find((s) => s.player === 'white')?.connected).toBe(true);

    // And her surviving socket still works.
    const stillWorks = await emit(alice, 'game:openingRoll');
    expect(stillWorks.ok).toBe(true);
  });

  it('serves a health endpoint', async () => {
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
