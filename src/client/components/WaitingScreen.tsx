import { useCopy } from '../hooks/useCopy';
import { shareUrl } from '../identity';
import { cx } from '../util';
import { CheckIcon, CopyIcon } from './Icons';

interface WaitingScreenProps {
  readonly code: string;
  readonly stake: number;
  readonly onLeave: () => void;
  readonly onCopyFailed: () => void;
}

export function WaitingScreen(props: WaitingScreenProps): JSX.Element {
  const { code, stake, onLeave, onCopyFailed } = props;
  const { copied, copy } = useCopy();
  const url = shareUrl(code);

  const run = (value: string, tag: string): void => {
    void copy(value, tag).then((ok) => {
      if (!ok) onCopyFailed();
    });
  };

  return (
    <main className="waiting">
      <div className="card card--wide">
        <p className="waiting__eyebrow">Table open</p>
        <h1 className="waiting__code" aria-label={`Table code ${code.split('').join(' ')}`}>
          {code.split('').map((char, i) => (
            <span key={`${char}-${i}`} className="waiting__char">
              {char}
            </span>
          ))}
        </h1>

        <div className="waiting__actions">
          <button
            type="button"
            className={cx('btn', copied === 'code' ? 'btn--accent' : 'btn--primary')}
            onClick={() => run(code, 'code')}
          >
            {copied === 'code' ? <CheckIcon className="btn__icon" /> : <CopyIcon className="btn__icon" />}
            {copied === 'code' ? 'Code copied' : 'Copy code'}
          </button>
          <button
            type="button"
            className={cx('btn', copied === 'link' ? 'btn--accent' : 'btn--outline')}
            onClick={() => run(url, 'link')}
          >
            {copied === 'link' ? <CheckIcon className="btn__icon" /> : <CopyIcon className="btn__icon" />}
            {copied === 'link' ? 'Link copied' : 'Copy link'}
          </button>
        </div>

        <p className="waiting__url" title={url}>
          {url}
        </p>

        <p className="waiting__status">
          <span className="waiting__pulse" aria-hidden="true" />
          Waiting for an opponent to join.
        </p>

        <p className="waiting__stake">Playing for {stake} chips a point.</p>

        <button type="button" className="btn btn--quiet btn--sm" onClick={onLeave}>
          Close table
        </button>
      </div>
    </main>
  );
}
