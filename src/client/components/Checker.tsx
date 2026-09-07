import type { CSSProperties, DragEvent } from 'react';

import type { Player } from '../../engine/types';
import { stackOverlapRatio } from '../boardLayout';
import { cx } from '../util';

interface CheckerStackProps {
  readonly color: Player | null;
  readonly count: number;
  /** Which screen edge the base of the point sits against. */
  readonly stackFrom: 'top' | 'bottom';
  readonly canDrag?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLSpanElement>) => void;
  readonly onDragEnd?: (event: DragEvent<HTMLSpanElement>) => void;
  /** Checkers stacked edge to edge before overlap kicks in. */
  readonly freeStack?: number;
  /** Show an empty ring at the next slot: this is where a checker would land. */
  readonly ghost?: boolean;
}

/**
 * A column of checkers that occupies at most `freeStack` checkers of height
 * however many are on the point, so even fifteen on one point cannot overflow.
 *
 * DOM order always runs down the screen. Which end of that column is the base
 * of the point flips with the row, so the logical index (0 = against the base)
 * is mapped to DOM position rather than assumed.
 */
export function CheckerStack(props: CheckerStackProps): JSX.Element | null {
  const {
    color,
    count,
    stackFrom,
    canDrag,
    onDragStart,
    onDragEnd,
    freeStack = 5,
    ghost = false,
  } = props;

  const real = color === null ? 0 : Math.max(0, count);
  if (real === 0 && !ghost) return null;

  const slots = real + (ghost ? 1 : 0);
  const overlap = stackOverlapRatio(slots, freeStack);
  const logicalOrder: number[] = [];
  for (let i = 0; i < slots; i += 1) {
    logicalOrder.push(stackFrom === 'top' ? i : slots - 1 - i);
  }

  return (
    <span className={cx('stack', `stack--${stackFrom}`)}>
      {logicalOrder.map((logical, domIndex) => {
        // Percentage margins resolve against the containing block's WIDTH, and
        // the checker is itself sized as a percentage of that width, so the
        // whole stack stays proportional at every viewport with no measuring.
        const style: CSSProperties = {
          marginTop: domIndex === 0 ? undefined : `calc(var(--checker-size) * ${-overlap})`,
          // Flex items honour z-index at position static: each checker laps the
          // one before it, away from the base of the point.
          zIndex: logical + 1,
        };

        if (ghost && logical === slots - 1) {
          return <span key="ghost" className="checker checker--ghost" style={style} />;
        }

        const isTip = logical === real - 1;
        const drag = canDrag === true && isTip;
        return (
          <span
            key={logical}
            className={cx('checker', `checker--${color}`, drag && 'checker--liftable')}
            style={style}
            draggable={drag}
            onDragStart={drag ? onDragStart : undefined}
            onDragEnd={drag ? onDragEnd : undefined}
            aria-hidden="true"
          />
        );
      })}
    </span>
  );
}
