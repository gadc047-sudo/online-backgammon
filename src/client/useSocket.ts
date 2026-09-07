/**
 * The single socket connection and the single source of rendered truth.
 *
 * Every server push replaces local state wholesale (CLAUDE.md principle 1) —
 * this hook never merges, patches or reconciles a snapshot. Disconnects are
 * expected, not exceptional (principle 4): on every reconnect we re-emit
 * `room:join` with the stored code and playerId to reclaim the same seat, and
 * the server answers with a full snapshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type { Move } from '../engine/types';
import type {
  Ack,
  ClientToServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
} from '../shared/protocol';
import { getStoredCode, setStoredCode } from './identity';

type BgSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting';

/** Fire-and-forget events: no payload, ack carries only success or an error. */
export type SimpleEvent =
  | 'game:roll'
  | 'game:openingRoll'
  | 'game:undo'
  | 'game:endTurn'
  | 'game:resign'
  | 'game:rematch'
  | 'cube:double';

const ACK_TIMEOUT_MS = 10_000;
const BOOT_TIMEOUT_MS = 6_000;

/**
 * Socket.IO acks never fire if the server drops the request, which would leave
 * a button spinning forever. Every call gets a deadline instead.
 */
function withDeadline<T>(run: (ack: (res: Ack<T>) => void) => void): Promise<Ack<T>> {
  return new Promise<Ack<T>>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'The server did not reply. Check your connection.' });
    }, ACK_TIMEOUT_MS);
    try {
      run((res) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(res);
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' });
    }
  });
}

/** Narrowed one event at a time so the typed emit map stays honest. */
function emitSimple(socket: BgSocket, event: SimpleEvent, ack: (res: Ack<null>) => void): void {
  switch (event) {
    case 'game:roll':
      socket.emit('game:roll', ack);
      return;
    case 'game:openingRoll':
      socket.emit('game:openingRoll', ack);
      return;
    case 'game:undo':
      socket.emit('game:undo', ack);
      return;
    case 'game:endTurn':
      socket.emit('game:endTurn', ack);
      return;
    case 'game:resign':
      socket.emit('game:resign', ack);
      return;
    case 'game:rematch':
      socket.emit('game:rematch', ack);
      return;
    case 'cube:double':
      socket.emit('cube:double', ack);
      return;
    default: {
      const unreachable: never = event;
      throw new Error(`Unhandled event ${String(unreachable)}`);
    }
  }
}

export interface UseSocketOptions {
  readonly playerId: string;
  /** Name used when silently re-joining after a drop. */
  readonly nameRef: React.MutableRefObject<string>;
  readonly onError: (message: string) => void;
  readonly onNotice: (message: string) => void;
  /**
   * Skip the silent restore. Set when the visitor arrived on a share link: the
   * table they were invited to beats the one they happened to leave open.
   */
  readonly suppressResume?: boolean;
}

export interface SocketApi {
  readonly status: ConnectionStatus;
  readonly snapshot: RoomSnapshot | null;
  /** True while we are trying to silently restore a room from localStorage. */
  readonly resuming: boolean;
  createRoom(name: string, stake: number): Promise<Ack<{ code: string }>>;
  joinRoom(name: string, code: string): Promise<Ack<{ code: string }>>;
  leaveRoom(): Promise<void>;
  send(event: SimpleEvent): Promise<void>;
  sendMove(move: Move): Promise<void>;
  respondToCube(accept: boolean): Promise<void>;
}

export function useSocket(options: UseSocketOptions): SocketApi {
  const { playerId, nameRef, onError, onNotice, suppressResume = false } = options;

  // Read storage exactly once per mount, not on every render.
  const [storedCode] = useState<string | null>(() => (suppressResume ? null : getStoredCode()));
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [resuming, setResuming] = useState<boolean>(storedCode !== null);

  const socketRef = useRef<BgSocket | null>(null);
  /** The room we believe we belong to. Drives rejoin-on-connect. */
  const roomCodeRef = useRef<string | null>(storedCode);
  const resumingRef = useRef(resuming);
  const onErrorRef = useRef(onError);
  const onNoticeRef = useRef(onNotice);

  onErrorRef.current = onError;
  onNoticeRef.current = onNotice;

  const stopResuming = useCallback(() => {
    resumingRef.current = false;
    setResuming(false);
  }, []);

  useEffect(() => {
    // Same origin: vite proxies /socket.io to the Node process in dev, and the
    // same Node process serves the built client in production.
    const socket: BgSocket = io({
      autoConnect: true,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4_000,
    });
    socketRef.current = socket;

    const bootTimer = window.setTimeout(() => {
      if (resumingRef.current) stopResuming();
    }, BOOT_TIMEOUT_MS);

    const handleConnect = (): void => {
      setStatus('online');
      const code = roomCodeRef.current;
      if (code === null) {
        stopResuming();
        return;
      }
      const wasResuming = resumingRef.current;
      socket.emit(
        'room:join',
        { playerId, name: nameRef.current, code },
        (res: Ack<{ code: string }>) => {
          if (res.ok) {
            stopResuming();
            return;
          }
          roomCodeRef.current = null;
          setStoredCode(null);
          setSnapshot(null);
          // A silent restore that fails is not worth interrupting anyone over.
          // A mid-session rejoin that fails absolutely is.
          if (!wasResuming) {
            onErrorRef.current(res.error ?? 'Could not rejoin that table.');
          }
          stopResuming();
        },
      );
    };

    const handleDisconnect = (reason: Socket.DisconnectReason): void => {
      setStatus('reconnecting');
      if (reason === 'io server disconnect') socket.connect();
    };

    const handleConnectError = (): void => {
      setStatus('reconnecting');
      if (resumingRef.current) stopResuming();
    };

    const handleSnapshot = (next: RoomSnapshot): void => {
      roomCodeRef.current = next.code;
      setStoredCode(next.code);
      setSnapshot(next);
      stopResuming();
    };

    const handleClosed = (payload: { reason: string }): void => {
      roomCodeRef.current = null;
      setStoredCode(null);
      setSnapshot(null);
      onNoticeRef.current(payload.reason);
    };

    const handleServerError = (payload: { message: string }): void => {
      onErrorRef.current(payload.message);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room:snapshot', handleSnapshot);
    socket.on('room:closed', handleClosed);
    socket.on('error:message', handleServerError);

    return () => {
      window.clearTimeout(bootTimer);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room:snapshot', handleSnapshot);
      socket.off('room:closed', handleClosed);
      socket.off('error:message', handleServerError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [playerId, nameRef, stopResuming]);

  const createRoom = useCallback(
    async (name: string, stake: number): Promise<Ack<{ code: string }>> => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: 'Not connected yet. One moment.' };
      const res = await withDeadline<{ code: string }>((ack) =>
        socket.emit('room:create', { playerId, name, stake }, ack),
      );
      if (res.ok && res.data) {
        roomCodeRef.current = res.data.code;
        setStoredCode(res.data.code);
      }
      return res;
    },
    [playerId],
  );

  const joinRoom = useCallback(
    async (name: string, code: string): Promise<Ack<{ code: string }>> => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: 'Not connected yet. One moment.' };
      const res = await withDeadline<{ code: string }>((ack) =>
        socket.emit('room:join', { playerId, name, code }, ack),
      );
      if (res.ok) {
        roomCodeRef.current = res.data?.code ?? code;
        setStoredCode(roomCodeRef.current);
      }
      return res;
    },
    [playerId],
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    const socket = socketRef.current;
    roomCodeRef.current = null;
    setStoredCode(null);
    setSnapshot(null);
    if (!socket) return;
    const res = await withDeadline<null>((ack) => socket.emit('room:leave', ack));
    if (!res.ok && res.error) onErrorRef.current(res.error);
  }, []);

  const send = useCallback(async (event: SimpleEvent): Promise<void> => {
    const socket = socketRef.current;
    if (!socket) {
      onErrorRef.current('Not connected yet. One moment.');
      return;
    }
    const res = await withDeadline<null>((ack) => emitSimple(socket, event, ack));
    // Never swallow an ack error: the board will not have changed and the
    // player deserves to know why.
    if (!res.ok) onErrorRef.current(res.error ?? 'That action was rejected.');
  }, []);

  const sendMove = useCallback(async (move: Move): Promise<void> => {
    const socket = socketRef.current;
    if (!socket) {
      onErrorRef.current('Not connected yet. One moment.');
      return;
    }
    const res = await withDeadline<null>((ack) => socket.emit('game:move', { move }, ack));
    if (!res.ok) onErrorRef.current(res.error ?? 'That move was rejected.');
  }, []);

  const respondToCube = useCallback(async (accept: boolean): Promise<void> => {
    const socket = socketRef.current;
    if (!socket) {
      onErrorRef.current('Not connected yet. One moment.');
      return;
    }
    const res = await withDeadline<null>((ack) => socket.emit('cube:respond', { accept }, ack));
    if (!res.ok) onErrorRef.current(res.error ?? 'That response was rejected.');
  }, []);

  return {
    status,
    snapshot,
    resuming,
    createRoom,
    joinRoom,
    leaveRoom,
    send,
    sendMove,
    respondToCube,
  };
}
