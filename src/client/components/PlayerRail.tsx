import type { Player } from '../../engine/types';
import type { Seat } from '../../shared/protocol';
import { cx } from '../util';

interface PlayerRailProps {
  readonly seat: Seat | null;
  readonly player: Player;
  readonly isYou: boolean;
  readonly isTurn: boolean;
  readonly pip: number;
  readonly borneOff: number;
  readonly onBar: number;
}

/**
 * One player's line: who they are, their chips, whether they are actually
 * connected, and the two numbers that decide a backgammon game — pip count and
 * checkers borne off.
 */
export function PlayerRail(props: PlayerRailProps): JSX.Element {
  const { seat, player, isYou, isTurn, pip, borneOff, onBar } = props;

  if (seat === null) {
    return (
      <div className="rail rail--empty">
        <span className={cx('rail__disc', `rail__disc--${player}`)} aria-hidden="true" />
        <span className="rail__name rail__name--empty">Empty seat</span>
        <span className="rail__wait">Waiting for an opponent</span>
      </div>
    );
  }

  return (
    <div className={cx('rail', isTurn && 'rail--turn', !seat.connected && 'rail--away')}>
      <span className={cx('rail__disc', `rail__disc--${player}`)} aria-hidden="true" />
      <span className="rail__id">
        <span className="rail__name">
          {seat.name}
          {isYou ? <span className="rail__you">you</span> : null}
        </span>
        <span className="rail__meta">
          <span className={cx('rail__dot', seat.connected ? 'rail__dot--on' : 'rail__dot--off')} />
          {seat.connected ? 'Connected' : 'Disconnected'}
        </span>
      </span>
      <span className="rail__stats">
        <span className="stat">
          <span className="stat__value">{seat.chips}</span>
          <span className="stat__label">chips</span>
        </span>
        <span className="stat">
          <span className="stat__value">{pip}</span>
          <span className="stat__label">pips</span>
        </span>
        <span className="stat">
          <span className="stat__value">{borneOff}</span>
          <span className="stat__label">off</span>
        </span>
        {onBar > 0 ? (
          <span className="stat stat--alert">
            <span className="stat__value">{onBar}</span>
            <span className="stat__label">bar</span>
          </span>
        ) : null}
      </span>
      {isTurn ? <span className="rail__turn">To play</span> : null}
    </div>
  );
}
