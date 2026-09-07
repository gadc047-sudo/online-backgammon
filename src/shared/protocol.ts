/**
 * The wire contract between browser and server.
 *
 * Shared rather than duplicated, per CLAUDE.md. This module may import engine
 * TYPES but must never be imported BY the engine.
 */

import type { GameState, Move, Player, WinType } from '../engine/types';

/** Chips are virtual. Play money only — no currency, no cash-out, no payments. */
export const STARTING_CHIPS = 1000;

/** Chips wagered per point of the final score, before cube and gammon multipliers. */
export const DEFAULT_STAKE = 25;
export const MIN_STAKE = 5;
export const MAX_STAKE = 100;

export const ROOM_CODE_LENGTH = 5;

/** How long a room survives with no connected players before it is reaped. */
export const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;

/** A seat at the table. `player` is the checker colour they control. */
export interface Seat {
  readonly playerId: string;
  readonly name: string;
  readonly player: Player;
  readonly chips: number;
  readonly connected: boolean;
  /** True for the computer opponent's seat in a vs-computer table. */
  readonly isComputer: boolean;
}

export type RoomStatus = 'waiting' | 'playing' | 'game-over';

/** Everything a client needs to render. Sent whole on every change — never a
 *  delta, so a reconnecting client resyncs by snapshot (principle 4). */
export interface RoomSnapshot {
  readonly code: string;
  readonly status: RoomStatus;
  readonly stake: number;
  readonly seats: readonly Seat[];
  /** Which seat the recipient of this snapshot occupies. null if not seated. */
  readonly you: Player | null;
  readonly game: GameState | null;
  /** Server-computed for the requesting client: the moves they may make now. */
  readonly legalMoves: readonly Move[];
  /** True when the requesting client may end their turn (no legal moves left). */
  readonly canEndTurn: boolean;
  /** True when the requesting client may offer a double right now. */
  readonly canDouble: boolean;
  /** Human-readable log of what has happened, newest last. */
  readonly log: readonly LogEntry[];
  /** Chips transferred by the last completed game, for the result banner. */
  readonly lastResult: GameResult | null;
  /** Seats that have asked for a rematch. A new game starts when both have. */
  readonly rematchRequestedBy: readonly Player[];
}

export interface LogEntry {
  readonly id: number;
  readonly text: string;
}

export interface GameResult {
  readonly winner: Player;
  readonly winnerName: string;
  readonly winType: WinType;
  readonly cubeValue: number;
  readonly points: number;
  readonly chips: number;
}

export interface Ack<T> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

/** Client -> Server. Every handler re-validates server-side (principle 1). */
export interface ClientToServerEvents {
  'room:create': (
    payload: { playerId: string; name: string; stake: number },
    ack: (res: Ack<{ code: string }>) => void,
  ) => void;
  /** Instant table: a human seat plus a computer seat, no share code needed. */
  'room:createVsComputer': (
    payload: { playerId: string; name: string; stake: number },
    ack: (res: Ack<{ code: string }>) => void,
  ) => void;
  'room:join': (
    payload: { playerId: string; name: string; code: string },
    ack: (res: Ack<{ code: string }>) => void,
  ) => void;
  'room:leave': (ack: (res: Ack<null>) => void) => void;

  'game:roll': (ack: (res: Ack<null>) => void) => void;
  'game:openingRoll': (ack: (res: Ack<null>) => void) => void;
  'game:move': (payload: { move: Move }, ack: (res: Ack<null>) => void) => void;
  'game:undo': (ack: (res: Ack<null>) => void) => void;
  'game:endTurn': (ack: (res: Ack<null>) => void) => void;
  'game:resign': (ack: (res: Ack<null>) => void) => void;
  'game:rematch': (ack: (res: Ack<null>) => void) => void;

  'cube:double': (ack: (res: Ack<null>) => void) => void;
  'cube:respond': (payload: { accept: boolean }, ack: (res: Ack<null>) => void) => void;
}

/** Server -> Client. */
export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'room:closed': (payload: { reason: string }) => void;
  'error:message': (payload: { message: string }) => void;
}
