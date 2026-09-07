import type { DragEvent, KeyboardEvent } from 'react';

import type { Player } from '../../engine/types';
import { gridColumnForSlot, type BoardRow } from '../boardLayout';
import { cx, plural } from '../util';
import { CheckerStack } from './Checker';

interface PointProps {
  readonly point: number;
  readonly color: Player | null;
  readonly count: number;
  readonly row: BoardRow;
  readonly index: number;
  readonly isHome: boolean;
  readonly isOrigin: boolean;
  readonly isSelected: boolean;
  readonly isTarget: boolean;
  /** An origin is chosen and this point is not one of its landings. */
  readonly isMuted: boolean;
  readonly onTap: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDrop: () => void;
}

export function Point(props: PointProps): JSX.Element {
  const {
    point,
    color,
    count,
    row,
    index,
    isHome,
    isOrigin,
    isSelected,
    isTarget,
    isMuted,
    onTap,
    onDragStart,
    onDragEnd,
    onDrop,
  } = props;

  const interactive = isOrigin || isTarget;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onTap();
  };

  const handleDragStart = (event: DragEvent<HTMLSpanElement>): void => {
    // Firefox will not start a drag without payload on the transfer.
    event.dataTransfer.setData('text/plain', String(point));
    event.dataTransfer.effectAllowed = 'move';
    onDragStart();
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

  const occupancy =
    count === 0 ? 'empty' : `${count} ${color ?? ''} ${plural(count, 'checker', 'checkers')}`;
  const state = isSelected
    ? ', selected'
    : isTarget
      ? ', legal landing'
      : isOrigin
        ? ', can move'
        : '';

  return (
    <div
      className={cx(
        'pt',
        `pt--${row}`,
        index % 2 === 0 ? 'pt--a' : 'pt--b',
        isHome && 'pt--home',
        isOrigin && 'pt--origin',
        isSelected && 'pt--selected',
        isTarget && 'pt--target',
        isMuted && 'pt--muted',
      )}
      style={{ gridColumn: gridColumnForSlot(index), gridRow: row === 'top' ? 2 : 4 }}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      aria-label={`Point ${point}, ${occupancy}${state}`}
      onClick={onTap}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <span className="pt__tri" aria-hidden="true" />
      <CheckerStack
        color={color}
        count={count}
        stackFrom={row}
        canDrag={isOrigin}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        ghost={isTarget}
      />
      {count > 5 ? (
        <span className="pt__badge" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </div>
  );
}
