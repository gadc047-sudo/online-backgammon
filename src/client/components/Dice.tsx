import type { DieValue, Player } from '../../engine/types';
import type { DieFace } from '../util';
import { cx, rollSummary } from '../util';

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
  readonly faces: readonly DieFace[];
  readonly owner: Player;
  readonly size?: 'md' | 'lg';
}

/**
 * The live roll.
 *
 * Doubles are the reason this is more than a row of dice. Four identical faces
 * are easy to skim as "the dice" without registering that the turn is worth
 * four moves rather than two, so a double gets its own surface, a badge naming
 * the face, and a count of what is still unplayed. A normal roll gets none of
 * that chrome — the two dice say everything already.
 *
 * The dice themselves are hidden from assistive tech and the whole tray carries
 * one sentence instead, because four separate "Die showing 3" announcements are
 * worse than "Double 3s — four moves, two of four still to play."
 */
export function DiceRow(props: DiceRowProps): JSX.Element | null {
  const { faces, owner, size } = props;
  if (faces.length === 0) return null;
  const roll = rollSummary(faces);

  return (
    <div
      className={cx('dice-tray', roll.isDouble && 'dice-tray--double')}
      role="img"
      aria-label={roll.label}
    >
      {roll.isDouble ? (
        <div className="dice-tray__head">
          <span className="dice-tray__badge">
            <span>Double {roll.value}s</span>
            <span className="dice-tray__badge-mult">4 moves</span>
          </span>
          <span
            className={cx(
              'dice-tray__count',
              roll.remaining === 0 && 'dice-tray__count--done',
            )}
          >
            {roll.countLabel}
          </span>
        </div>
      ) : null}
      <span className="dice-row" aria-hidden="true">
        {faces.map((face) => (
          <Die key={face.key} value={face.value} spent={face.spent} owner={owner} size={size} />
        ))}
      </span>
    </div>
  );
}
