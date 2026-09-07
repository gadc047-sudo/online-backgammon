import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import express from 'express';
import type { Server as SocketServer } from 'socket.io';

import { RoomRegistry } from './rooms';
import { attachSocketServer } from './socket';

const REAP_INTERVAL_MS = 5 * 60 * 1000;

export interface AppServer {
  app: express.Express;
  httpServer: http.Server;
  io: SocketServer;
  registry: RoomRegistry;
  close: () => Promise<void>;
}

/**
 * Builds the HTTP + realtime server without listening, so tests can bind an
 * ephemeral port and shut down cleanly.
 */
export function createServer(registry: RoomRegistry = new RoomRegistry()): AppServer {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: registry.size });
  });

  // In production the client is a static bundle emitted next to the server
  // build: dist/server/index.js and dist/public/. In development Vite serves it
  // on :5173 and proxies here, so the directory simply will not exist.
  const clientDir = path.join(__dirname, '../public');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const io = attachSocketServer(httpServer, registry);

  const reaper = setInterval(() => {
    const removed = registry.reap();
    if (removed > 0) console.log(`[rooms] reaped ${removed} idle table(s)`);
  }, REAP_INTERVAL_MS);
  reaper.unref();

  const close = async (): Promise<void> => {
    clearInterval(reaper);
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { app, httpServer, io, registry, close };
}

export function startServer(port: number = Number(process.env.PORT) || 3001): AppServer {
  const server = createServer();
  // 0.0.0.0 rather than localhost: container platforms route to the external
  // interface, and binding loopback only would make the service unreachable.
  server.httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[server] backgammon listening on http://0.0.0.0:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

export { RoomRegistry } from './rooms';
