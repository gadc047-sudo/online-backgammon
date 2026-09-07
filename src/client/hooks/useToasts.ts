/**
 * Transient messages. Every rejected ack lands here — a move that the server
 * refused must never fail silently, because the board simply will not change
 * and the player is left guessing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'error' | 'notice';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

const TOAST_MS = 5_000;
const MAX_TOASTS = 3;

export interface ToastApi {
  readonly toasts: readonly Toast[];
  pushError(message: string): void;
  pushNotice(message: string): void;
  dismiss(id: number): void;
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const text = message.trim();
      if (text.length === 0) return;
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => {
        // Repeating the same rejection is noise, not information.
        const deduped = current.filter((t) => t.message !== text);
        return [...deduped, { id, tone, message: text }].slice(-MAX_TOASTS);
      });
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  const pushError = useCallback((message: string) => push('error', message), [push]);
  const pushNotice = useCallback((message: string) => push('notice', message), [push]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, pushError, pushNotice, dismiss };
}
