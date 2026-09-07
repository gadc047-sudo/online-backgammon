import type { DieValue, Player } from '../../engine/types';
import { cx } from '../util';

/** Pip positions on a 3x3 grid, cells numbered 1..9 reading left to right. */
const PIPS: Record<DieValue, readonly number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

interface DieProps {
  readonly value: DieValue;
  readonly spent?: boolean;
  readonly owner?: Player;
  readonly size?: 'md' | 'lg';
}

export function Die(props: DieProps): JSX.Element {
  const { value, spent = false, owner = 'white', size = 'md' } = props;
  const cells = PIPS[value];
  return (
    <span
      className={cx('die', `die--${owner}`, `die--${size}`, spent && 'die--spent')}
      role="img"
      aria-label={`Die showing ${value}${spent ? ', played' : ''}`}
    >
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cell) => (
        <span key={cell} className={cx('die__cell', cells.includes(cell) && 'die__cell--pip')} />
      ))}
    </span>
  );
}

interface DiceRowProps {
  readonly faces: readonly { value: DieValue; spent: boolean; key: string }[];
  readonly owner: Player;
  readonly size?: 'md' | 'lg';
}

export function DiceRow(props: DiceRowProps): JSX.Element | null {
  const { faces, owner, size } = props;
  if (faces.length === 0) return null;
  return (
    <span className="dice-row">
      {faces.map((face) => (
        <Die key={face.key} value={face.value} spent={face.spent} owner={owner} size={size} />
      ))}
    </span>
  );
}
