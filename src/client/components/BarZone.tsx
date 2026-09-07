import type { DragEvent, KeyboardEvent } from 'react';

import type { Player } from '../../engine/types';
import { cx, plural } from '../util';
import { CheckerStack } from './Checker';

interface BarZoneProps {
  readonly side: 'top' | 'bottom';
  readonly color: Player;
  readonly count: number;
  /** True when these are the viewer's own checkers. */
  readonly isYours: boolean;
  readonly isOrigin: boolean;
  readonly isSelected: boolean;
  readonly isMuted: boolean;
  readonly onTap: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}

/**
 * Half of the bar. The viewer's own half sits at the top, in line with the
 * quadrant a checker re-enters into, so the journey off the bar reads as one
 * continuous move rather than a jump across the board.
 *
 * When it is yours and occupied this has to shout: a checker on the bar is the
 * only thing you are allowed to move, and it is the single rule new players
 * miss most often.
 */
export function BarZone(props: BarZoneProps): JSX.Element {
  const { side, color, count, isYours, isOrigin, isSelected, isMuted, onTap, onDragStart, onDragEnd } =
    props;

  const alert = isYours && count > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onTap();
  };

  const handleDragStart = (event: DragEvent<HTMLSpanElement>): void => {
    event.dataTransfer.setData('text/plain', 'bar');
    event.dataTransfer.effectAllowed = 'move';
    onDragStart();
  };

  return (
    <div
      className={cx(
        'bar__zone',
        `bar__zone--${side}`,
        alert && 'bar__zone--alert',
        isOrigin && 'bar__zone--origin',
        isSelected && 'bar__zone--selected',
        isMuted && 'bar__zone--muted',
      )}
      role={isOrigin ? 'button' : undefined}
      tabIndex={isOrigin ? 0 : -1}
      aria-label={
        count > 0
          ? `${isYours ? 'Your' : 'Opponent'} bar, ${count} ${plural(count, 'checker', 'checkers')}`
          : undefined
      }
      onClick={isOrigin ? onTap : undefined}
      onKeyDown={isOrigin ? handleKeyDown : undefined}
    >
      <CheckerStack
        color={color}
        count={count}
        stackFrom={side}
        canDrag={isOrigin}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        freeStack={3}
      />
      {alert ? (
        <span className="bar__flag" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </div>
  );
}
