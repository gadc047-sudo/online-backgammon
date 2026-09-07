import type { ConnectionStatus } from '../useSocket';
import { cx } from '../util';

interface ConnectionBadgeProps {
  readonly status: ConnectionStatus;
  /** null when nobody has taken the other seat yet. */
  readonly opponentConnected: boolean | null;
  readonly opponentName: string;
}

/**
 * One badge for the two things that can go wrong with the wire. Your own socket
 * comes first: if you are offline, nothing you read about the opponent is news.
 */
export function ConnectionBadge(props: ConnectionBadgeProps): JSX.Element {
  const { status, opponentConnected, opponentName } = props;

  if (status !== 'online') {
    return (
      <span className={cx('conn', 'conn--warn')}>
        <span className="conn__dot conn__dot--pulse" aria-hidden="true" />
        {status === 'connecting' ? 'Connecting' : 'Reconnecting'}
      </span>
    );
  }

  if (opponentConnected === false) {
    return (
      <span className={cx('conn', 'conn--warn')}>
        <span className="conn__dot conn__dot--pulse" aria-hidden="true" />
        {opponentName} dropped out
      </span>
    );
  }

  return (
    <span className={cx('conn', 'conn--ok')}>
      <span className="conn__dot" aria-hidden="true" />
      Connected
    </span>
  );
}
