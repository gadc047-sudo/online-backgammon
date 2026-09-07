import type { Toast } from '../hooks/useToasts';
import { cx } from '../util';

interface ToastsProps {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: number) => void;
}

/** Rejected acks land here. A refused move must never vanish without a word. */
export function Toasts(props: ToastsProps): JSX.Element | null {
  const { toasts, onDismiss } = props;
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={cx('toast', `toast--${toast.tone}`)}
          onClick={() => onDismiss(toast.id)}
        >
          {toast.message}
          <span className="toast__dismiss" aria-hidden="true">
            Dismiss
          </span>
        </button>
      ))}
    </div>
  );
}
