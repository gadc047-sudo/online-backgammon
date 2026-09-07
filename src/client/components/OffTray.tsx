import type { DragEvent, KeyboardEvent } from 'react';

import type { Player } from '../../engine/types';
import { cx } from '../util';

const CHECKERS_PER_SIDE = 15;

interface OffTrayProps {
  readonly side: 'top' | 'bottom';
  readonly color: Player;
  readonly count: number;
  readonly isYours: boolean;
  readonly isTarget: boolean;
  readonly isMuted: boolean;
  readonly onTap: () => void;
  readonly onDrop: () => void;
}

/** Bear-off tray. Borne-off checkers lie flat, as they do on a real board. */
export function OffTray(props: OffTrayProps): JSX.Element {
  const { side, color, count, isYours, isTarget, isMuted, onTap, onDrop } = props;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onTap();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!isTarget) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!isTarget) return;
    event.preventDefault();
    onDrop();
  };

  const slabs: JSX.Element[] = [];
  for (let i = 0; i < count; i += 1) {
    slabs.push(<span key={i} className="tray__slab" />);
  }

  return (
    <div
      className={cx(
        'tray',
        `tray--${side}`,
        `tray--${color}`,
        isTarget && 'tray--target',
        isMuted && 'tray--muted',
      )}
      style={{ gridColumn: 14, gridRow: side === 'top' ? 2 : 4 }}
      role="button"
      tabIndex={isTarget ? 0 : -1}
      aria-disabled={!isTarget}
      aria-label={`${isYours ? 'Your' : 'Opponent'} tray, ${count} of ${CHECKERS_PER_SIDE} borne off${
        isTarget ? ', legal landing' : ''
      }`}
      onClick={onTap}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <span className="tray__slabs" aria-hidden="true">
        {slabs}
      </span>
      <span className="tray__count" aria-hidden="true">
        {count}
        <span className="tray__count-total">/{CHECKERS_PER_SIDE}</span>
      </span>
    </div>
  );
}
