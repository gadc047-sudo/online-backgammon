/**
 * Public surface of the pure backgammon rules engine.
 *
 * Imported by BOTH the server (authoritative) and the client (optimistic UI,
 * legal-move highlighting). The server's result always wins on conflict.
 */

export * from './types';
export * from './board';
export * from './moves';
export * from './game';
export * from './cube';
