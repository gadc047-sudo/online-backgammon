import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy to clipboard with a confirmation that fades. navigator.clipboard needs a
 * secure context, which http:// on a phone over the LAN is not, so fall back to
 * the old selection trick rather than leaving the button dead.
 */
export function useCopy(resetMs = 2_000): {
  copied: string | null;
  copy: (value: string, tag: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const flag = useCallback(
    (tag: string) => {
      setCopied(tag);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), resetMs);
    },
    [resetMs],
  );

  const copy = useCallback(
    async (value: string, tag: string): Promise<boolean> => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          flag(tag);
          return true;
        }
      } catch {
        /* fall through to the legacy path */
      }
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (ok) flag(tag);
        return ok;
      } catch {
        return false;
      }
    },
    [flag],
  );

  return { copied, copy };
}
