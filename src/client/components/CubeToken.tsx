import type { CubeState, Player } from '../../engine/types';
import { cx } from '../util';

interface CubeTokenProps {
  readonly cube: CubeState;
  /** The seat the board is drawn from. Spectators see it as white. */
  readonly viewer: Player;
}

/**
 * The doubling cube, sitting on the bar. Centred while nobody owns it, parked
 * at the owner's end once taken — the position is the ownership, exactly as on
 * a physical board, with a text label because that convention is not obvious to
 * everyone.
 */
export function CubeToken(props: CubeTokenProps): JSX.Element {
  const { cube, viewer } = props;
  const place = cube.owner === null ? 'centre' : cube.owner === viewer ? 'yours' : 'theirs';
  const label =
    cube.owner === null
      ? 'Doubling cube, centred, either player may double'
      : `Doubling cube at ${cube.value}, owned by ${cube.owner === viewer ? 'you' : 'your opponent'}`;

  return (
    <span className={cx('cube', `cube--${place}`)} role="img" aria-label={label}>
      <span className="cube__value">{cube.value}</span>
    </span>
  );
}
