import { randomInt } from 'node:crypto';

import { ROOM_CODE_LENGTH } from '../shared/protocol';

/**
 * Share codes are read aloud and typed on phones, so the alphabet drops every
 * character pair people confuse: I/1, O/0. What remains is unambiguous in both
 * upper case and most sans-serif fonts.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(length: number = ROOM_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET.charAt(randomInt(0, ALPHABET.length));
  }
  return code;
}

/** Accepts what a human typed and returns the canonical form, or null. */
export function normaliseCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== ROOM_CODE_LENGTH) return null;
  return cleaned;
}
