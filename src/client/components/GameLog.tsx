import { useEffect, useRef } from 'react';

import type { LogEntry } from '../../shared/protocol';

interface GameLogProps {
  readonly entries: readonly LogEntry[];
}

/** Chronological, newest last, pinned to the bottom like any transcript. */
export function GameLog(props: GameLogProps): JSX.Element {
  const { entries } = props;
  const scroller = useRef<HTMLOListElement>(null);
  const last = entries.length > 0 ? entries[entries.length - 1]?.id : undefined;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [last]);

  return (
    <section className="log" aria-label="Game log">
      <h2 className="log__title">Log</h2>
      {entries.length === 0 ? (
        <p className="log__empty">Moves and cube offers will appear here as you play.</p>
      ) : (
        <ol className="log__list" ref={scroller}>
          {entries.map((entry) => (
            <li key={entry.id} className="log__item">
              {entry.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
