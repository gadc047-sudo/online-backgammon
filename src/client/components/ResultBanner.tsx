import type { GameState, Player } from '../../engine/types';
import type { GameResult, Seat } from '../../shared/protocol';
import { cx, plural, reasonLabel, winTypeDetail, winTypeLabel } from '../util';

interface ResultBannerProps {
  readonly result: GameResult | null;
  readonly game: GameState;
  readonly you: Player | null;
  readonly youSeat: Seat | null;
  readonly opponentSeat: Seat | null;
  readonly rematchRequestedBy: readonly Player[];
  readonly onRematch: () => void;
  readonly onLeave: () => void;
}

/**
 * The result, over the board, with the arithmetic shown. Chips are game tokens
 * and are labelled as such — never a balance, never a currency.
 */
export function ResultBanner(props: ResultBannerProps): JSX.Element {
  const { result, game, you, youSeat, opponentSeat, rematchRequestedBy, onRematch, onLeave } = props;

  const winner = result?.winner ?? game.winner;
  const won = you !== null && winner === you;
  const winType = result?.winType ?? game.winType ?? 'single';
  const cubeValue = result?.cubeValue ?? game.cube.value;
  const points = result?.points ?? 0;
  const chips = result?.chips ?? 0;
  const reason = reasonLabel(game.winReason);

  const youAsked = you !== null && rematchRequestedBy.includes(you);
  const oppAsked = rematchRequestedBy.some((p) => p !== you);

  const rematchLabel = youAsked
    ? 'Rematch requested — waiting for opponent'
    : oppAsked
      ? 'Accept rematch'
      : 'Rematch';

  return (
    <div className={cx('result', won ? 'result--won' : 'result--lost')} role="status">
      <div className="result__card">
        <p className="result__eyebrow">{reason}</p>
        <h2 className="result__title">
          {result
            ? `${result.winnerName} wins`
            : you === null
              ? 'Game over'
              : won
                ? 'You win'
                : 'You lose'}
        </h2>
        <p className="result__type">
          {winTypeLabel(winType)}
          <span className="result__type-detail">{winTypeDetail(winType)}</span>
        </p>

        <dl className="result__maths">
          <div className="result__row">
            <dt>Cube</dt>
            <dd>{cubeValue}</dd>
          </div>
          <div className="result__row">
            <dt>Points</dt>
            <dd>
              {points} {plural(points, 'point', 'points')}
            </dd>
          </div>
          <div className="result__row result__row--strong">
            <dt>Chips moved</dt>
            <dd>{chips}</dd>
          </div>
        </dl>

        <div className="result__chips">
          {youSeat ? (
            <span className="result__chip">
              <span className="result__chip-name">{youSeat.name}</span>
              <span className="result__chip-value">{youSeat.chips}</span>
            </span>
          ) : null}
          {opponentSeat ? (
            <span className="result__chip">
              <span className="result__chip-name">{opponentSeat.name}</span>
              <span className="result__chip-value">{opponentSeat.chips}</span>
            </span>
          ) : null}
        </div>

        <div className="result__actions">
          <button
            type="button"
            className={cx('btn', oppAsked ? 'btn--accent' : 'btn--primary')}
            disabled={youAsked}
            onClick={onRematch}
          >
            {rematchLabel}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onLeave}>
            Leave table
          </button>
        </div>
        {oppAsked && !youAsked ? (
          <p className="result__hint">Your opponent is ready to go again.</p>
        ) : null}
      </div>
    </div>
  );
}
