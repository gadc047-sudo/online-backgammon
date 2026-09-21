import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';

import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';
import { createComputerDriver, type ComputerDriverOptions } from './ai/driver';
import { createJevDriver, type JevDriverOptions } from './ai/jev/driver';
import { RoomError, RoomRegistry, type Room } from './rooms';
import { createTypeSafeClient, type TypeSafeClient } from './typesafe/client';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface Session {
  playerId: string;
  code: string;
}

export interface AttachSocketServerOptions {
  /** Test-only override so a vs-computer game does not have to wait out real timers. */
  readonly computerDriver?: ComputerDriverOptions;
  readonly jevDriver?: JevDriverOptions;
  /** Injected in tests so the Jev lane never touches the real API. */
  readonly typeSafe?: TypeSafeClient;
}

export function attachSocketServer(
  httpServer: HttpServer,
  registry: RoomRegistry,
  options: AttachSocketServerOptions = {},
): TypedServer {
  const io: TypedServer = new Server(httpServer, {
    // Same-origin in production; Vite proxies /socket.io in development, so no
    // CORS allowance is needed in either case.
    serveClient: false,
    pingTimeout: 25000,
  });

  /** socket.id -> which player and table that socket is speaking for. */
  const sessions = new Map<string, Session>();

  /**
   * Snapshots are per-recipient (legal moves differ by seat), so we fan out one
   * tailored payload per connected socket rather than broadcasting one shared
   * object to the room.
   */
  function broadcast(room: Room | undefined): void {
    if (!room) return;
    for (const [socketId, session] of sessions) {
      if (session.code !== room.code) continue;
      const target = io.sockets.sockets.get(socketId);
      if (target) target.emit('room:snapshot', registry.snapshotFor(room, session.playerId));
    }
    // Every broadcast is a natural checkpoint to ask "does the computer have
    // something to do now?" — including broadcasts the computer's own last
    // move triggered, which is how a multi-hop turn plays itself out.
    //
    // Both drivers are poked on every table. Each only ever finds its own seat
    // (`isComputer && !isJev` versus `isJev`), so on an ordinary table the Jev
    // driver finds nothing and on a Jev table each drives one side.
    computerDriver.poke(room.code);
    jevDriver.poke(room.code);
  }

  const computerDriver = createComputerDriver(registry, broadcast, options.computerDriver);
  const typeSafe = options.typeSafe ?? createTypeSafeClient();
  const jevDriver = createJevDriver(registry, typeSafe, broadcast, options.jevDriver);

  function fail(ack: (res: Ack<never>) => void, error: unknown, context: string): void {
    if (error instanceof RoomError) {
      ack({ ok: false, error: error.message });
      return;
    }
    if (error instanceof Error && error.name === 'IllegalMoveError') {
      // The engine rejected it. Safe to surface: it describes the rule, not internals.
      ack({ ok: false, error: error.message });
      return;
    }
    console.error(`[socket] unexpected failure in ${context}:`, error);
    ack({ ok: false, error: 'Something went wrong. Try again.' });
  }

  /**
   * Every game action shares the same shape: find the caller's room, run the
   * registry mutation, acknowledge, then push fresh state to everyone at the
   * table. Errors acknowledge a failure and change nothing.
   */
  function action(
    socket: TypedSocket,
    name: string,
    ack: (res: Ack<null>) => void,
    run: (playerId: string) => Room,
  ): void {
    const session = sessions.get(socket.id);
    if (!session) {
      ack({ ok: false, error: 'You are not at a table.' });
      return;
    }
    try {
      const room = run(session.playerId);
      ack({ ok: true, data: null });
      broadcast(room);
    } catch (error) {
      fail(ack as (res: Ack<never>) => void, error, name);
    }
  }

  io.on('connection', (socket: TypedSocket) => {
    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { playerId, name, stake } = payload ?? {};
        if (!playerId || typeof playerId !== 'string') {
          ack({ ok: false, error: 'Missing player id.' });
          return;
        }
        const room = registry.createRoom(playerId, String(name ?? ''), Number(stake));
        sessions.set(socket.id, { playerId, code: room.code });
        void socket.join(room.code);
        ack({ ok: true, data: { code: room.code } });
        broadcast(room);
      } catch (error) {
        fail(ack as unknown as (res: Ack<never>) => void, error, 'room:create');
      }
    });

    socket.on('room:createVsComputer', (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { playerId, name, stake } = payload ?? {};
        if (!playerId || typeof playerId !== 'string') {
          ack({ ok: false, error: 'Missing player id.' });
          return;
        }
        const room = registry.createVsComputerRoom(playerId, String(name ?? ''), Number(stake));
        sessions.set(socket.id, { playerId, code: room.code });
        void socket.join(room.code);
        ack({ ok: true, data: { code: room.code } });
        broadcast(room);
      } catch (error) {
        fail(ack as unknown as (res: Ack<never>) => void, error, 'room:createVsComputer');
      }
    });

    socket.on('room:createJevDemo', (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { playerId, name, stake } = payload ?? {};
        if (!playerId || typeof playerId !== 'string') {
          ack({ ok: false, error: 'Missing player id.' });
          return;
        }
        // Fail here rather than opening a table that can never make a decision.
        // A missing key is a server misconfiguration, so it is reported once,
        // clearly, at the point the visitor asked for the lane.
        if (!typeSafe.configured) {
          ack({
            ok: false,
            error: 'Jev is not configured on this server. Set TYPESAFE_API_KEY and restart.',
          });
          return;
        }
        const room = registry.createJevDemoRoom(playerId, String(name ?? ''), Number(stake));
        sessions.set(socket.id, { playerId, code: room.code });
        void socket.join(room.code);
        ack({ ok: true, data: { code: room.code } });
        broadcast(room);
      } catch (error) {
        fail(ack as unknown as (res: Ack<never>) => void, error, 'room:createJevDemo');
      }
    });

    socket.on('room:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { playerId, name, code } = payload ?? {};
        if (!playerId || typeof playerId !== 'string') {
          ack({ ok: false, error: 'Missing player id.' });
          return;
        }
        const room = registry.joinRoom(String(code ?? ''), playerId, String(name ?? ''));
        sessions.set(socket.id, { playerId, code: room.code });
        void socket.join(room.code);
        ack({ ok: true, data: { code: room.code } });
        // The joining socket gets a full snapshot immediately; reconnect is a
        // resync by snapshot, never an event replay (CLAUDE.md principle 4).
        broadcast(room);
      } catch (error) {
        fail(ack as unknown as (res: Ack<never>) => void, error, 'room:join');
      }
    });

    socket.on('room:leave', (ack) => {
      if (typeof ack !== 'function') return;
      const session = sessions.get(socket.id);
      if (!session) {
        ack({ ok: true, data: null });
        return;
      }
      const room = registry.leaveRoom(session.playerId);
      sessions.delete(socket.id);
      void socket.leave(session.code);
      ack({ ok: true, data: null });
      if (room) {
        broadcast(room);
        io.to(room.code).emit('room:closed', { reason: 'A player left the table.' });
      }
    });

    socket.on('game:openingRoll', (ack) =>
      action(socket, 'game:openingRoll', ack, (id) => registry.openingRoll(id)),
    );
    socket.on('game:roll', (ack) => action(socket, 'game:roll', ack, (id) => registry.roll(id)));
    socket.on('game:move', (payload, ack) =>
      action(socket, 'game:move', ack, (id) => registry.move(id, payload?.move)),
    );
    socket.on('game:undo', (ack) => action(socket, 'game:undo', ack, (id) => registry.undo(id)));
    socket.on('game:endTurn', (ack) =>
      action(socket, 'game:endTurn', ack, (id) => registry.endTurn(id)),
    );
    socket.on('game:resign', (ack) =>
      action(socket, 'game:resign', ack, (id) => registry.resign(id)),
    );
    socket.on('game:rematch', (ack) =>
      action(socket, 'game:rematch', ack, (id) => registry.rematch(id)),
    );

    socket.on('cube:double', (ack) =>
      action(socket, 'cube:double', ack, (id) => registry.offerDouble(id)),
    );
    socket.on('cube:respond', (payload, ack) =>
      action(socket, 'cube:respond', ack, (id) => registry.respondToDouble(id, !!payload?.accept)),
    );

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);
      sessions.delete(socket.id);
      if (!session) return;

      // A player can legitimately hold more than one socket: a duplicate tab
      // shares localStorage and therefore the same playerId, and a flaky
      // network can leave a stale socket open while a new one is established.
      // Only report them away once the last of their sockets has gone, or
      // closing a spare tab would show their opponent a phantom disconnect.
      for (const other of sessions.values()) {
        if (other.playerId === session.playerId) return;
      }

      // Hold the seat. Mobile browsers drop sockets when a tab is backgrounded,
      // so a dropped connection must never forfeit a game.
      const room = registry.markDisconnected(session.playerId);
      broadcast(room);
    });
  });

  return io;
}
