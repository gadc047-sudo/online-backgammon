/**
 * Anonymous identity + local preferences.
 *
 * There are no accounts and no auth. A player is a UUID held in localStorage;
 * the server uses it to hand the same seat back after a reconnect. Every
 * storage call is guarded because Safari private mode throws on access.
 */

import { ROOM_CODE_LENGTH, STARTING_CHIPS } from '../shared/protocol';

const KEY_PLAYER_ID = 'backgammon.playerId';
const KEY_NAME = 'backgammon.name';
const KEY_CODE = 'backgammon.roomCode';
const KEY_CHIPS = 'backgammon.chips';

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the session still works, it just will not resume */
  }
}

function clearKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** crypto.randomUUID needs a secure context; fall back so http:// LAN play works. */
function newId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i] ?? 0;
      out += b.toString(16).padStart(2, '0');
    }
    return out;
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

let cachedPlayerId: string | null = null;

export function getPlayerId(): string {
  if (cachedPlayerId) return cachedPlayerId;
  const existing = readKey(KEY_PLAYER_ID);
  if (existing && existing.length > 0) {
    cachedPlayerId = existing;
    return existing;
  }
  const created = newId();
  writeKey(KEY_PLAYER_ID, created);
  cachedPlayerId = created;
  return created;
}

export function getStoredName(): string {
  return readKey(KEY_NAME) ?? '';
}

export function setStoredName(name: string): void {
  writeKey(KEY_NAME, name);
}

export function getStoredCode(): string | null {
  const code = readKey(KEY_CODE);
  return code && code.length === ROOM_CODE_LENGTH ? code : null;
}

export function setStoredCode(code: string | null): void {
  if (code === null) clearKey(KEY_CODE);
  else writeKey(KEY_CODE, code);
}

/** Last chip count we saw for this player, so Home has something true to show. */
export function getStoredChips(): number {
  const raw = readKey(KEY_CHIPS);
  if (raw === null) return STARTING_CHIPS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : STARTING_CHIPS;
}

export function setStoredChips(chips: number): void {
  writeKey(KEY_CHIPS, String(chips));
}

/** Room codes are typed by humans off a screenshot; be forgiving about case. */
export function normaliseCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function codeFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('code');
    if (!raw) return null;
    const code = normaliseCode(raw);
    return code.length === ROOM_CODE_LENGTH ? code : null;
  } catch {
    return null;
  }
}

export function shareUrl(code: string): string {
  return `${window.location.origin}/?code=${code}`;
}

/** Drop ?code= once it has been consumed so a refresh does not re-prefill it. */
export function clearCodeFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code')) return;
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch {
    /* ignore */
  }
}

export function defaultName(): string {
  const stored = getStoredName().trim();
  if (stored.length > 0) return stored;
  return `Player ${getPlayerId().slice(0, 4).toUpperCase()}`;
}
