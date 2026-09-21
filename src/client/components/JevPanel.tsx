import type { JevDecision, JevStatus } from '../../shared/protocol';
import { cx } from '../util';
import { SpinnerIcon } from './Icons';

interface JevPanelProps {
  readonly jev: JevStatus;
}

/**
 * Jev's last decision, rendered as structure and nothing else: what it chose,
 * how confident it was, and how the probability was spread across the options
 * it was given.
 *
 * There is deliberately no explanation here. The server never asks for one and
 * the model never returns one — the option labels are backgammon notation this
 * codebase computed before the question was sent, so everything on screen is
 * either a number from the model or a fact from the board.
 */

/** Enough to show the shape of the distribution without a wall of near-zeroes. */
const VISIBLE_OPTIONS = 5;

const KIND_LABEL: Record<JevDecision['kind'], string> = {
  move: 'Play',
  'cube-offer': 'Cube',
  'cube-response': 'Double offered',
};

function percent(value: number): string {
  // Two decimals below 1% so a long tail does not all read as "0%".
  if (value > 0 && value < 0.01) return `${(value * 100).toFixed(2)}%`;
  return `${Math.round(value * 100)}%`;
}

export function JevPanel({ jev }: JevPanelProps): JSX.Element {
  const { thinking, last, error } = jev;
  const shown = last ? last.options.slice(0, VISIBLE_OPTIONS) : [];
  const hidden = last ? last.options.length - shown.length : 0;

  return (
    <section className="jev" aria-label="Jev decision">
      <header className="jev__head">
        <span className="jev__mark" aria-hidden="true">
          J
        </span>
        <span className="jev__id">
          <span className="jev__name">Jev</span>
          <span className="jev__model">TypeSafe System One</span>
        </span>
        {thinking ? (
          <span className="jev__thinking" role="status">
            <SpinnerIcon className="jev__spin" />
            Thinking
          </span>
        ) : null}
      </header>

      {error ? (
        <p className="jev__error" role="status">
          {error} Heuristic fallback played this decision.
        </p>
      ) : null}

      {last === null ? (
        <p className="jev__idle">Waiting for Jev&rsquo;s first decision.</p>
      ) : (
        <div className="jev__body">
          <div className="jev__choice">
            <span className="jev__kind">{KIND_LABEL[last.kind]}</span>
            <span className="jev__pick">{last.choiceLabel}</span>
          </div>

          <dl className="jev__stats">
            <div className="jev__stat">
              <dt>Confidence</dt>
              <dd className={cx(last.confidence === null && 'jev__stat-value--none')}>
                {last.confidence === null ? '—' : percent(last.confidence)}
              </dd>
            </div>
            <div className="jev__stat">
              <dt>Options</dt>
              <dd>{last.consideredOf}</dd>
            </div>
            <div className="jev__stat">
              <dt>Source</dt>
              <dd className={cx(last.source === 'fallback' && 'jev__stat-value--warn')}>
                {last.source === 'jev' ? 'Jev' : 'Heuristic'}
              </dd>
            </div>
          </dl>

          <ol className="jev__options">
            {shown.map((option) => (
              <li
                key={option.key}
                className={cx('jev__option', option.key === last.choice && 'jev__option--picked')}
              >
                <span className="jev__option-label">{option.label}</span>
                <span className="jev__bar" aria-hidden="true">
                  <span
                    className="jev__bar-fill"
                    style={{ width: `${Math.max(option.probability * 100, 1)}%` }}
                  />
                </span>
                <span className="jev__option-prob">{percent(option.probability)}</span>
              </li>
            ))}
          </ol>
          {hidden > 0 ? (
            <p className="jev__more">
              {hidden} further {hidden === 1 ? 'option' : 'options'} below this.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
