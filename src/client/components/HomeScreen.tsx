import type { FormEvent } from 'react';

import { MAX_STAKE, MIN_STAKE, ROOM_CODE_LENGTH } from '../../shared/protocol';
import { cx } from '../util';
import { SpinnerIcon } from './Icons';

const STAKE_PRESETS = [5, 10, 25, 50, 100].filter((s) => s >= MIN_STAKE && s <= MAX_STAKE);

interface HomeScreenProps {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly stake: number;
  readonly onStakeChange: (stake: number) => void;
  readonly joinCode: string;
  readonly onJoinCodeChange: (code: string) => void;
  readonly chips: number;
  readonly busy: 'create' | 'join' | 'computer' | 'jev' | null;
  readonly online: boolean;
  readonly onCreate: () => void;
  readonly onPlayComputer: () => void;
  readonly onWatchJev: () => void;
  readonly onJoin: () => void;
}

export function HomeScreen(props: HomeScreenProps): JSX.Element {
  const {
    name,
    onNameChange,
    stake,
    onStakeChange,
    joinCode,
    onJoinCodeChange,
    chips,
    busy,
    online,
    onCreate,
    onPlayComputer,
    onWatchJev,
    onJoin,
  } = props;

  const nameOk = name.trim().length > 0;
  const codeOk = joinCode.length === ROOM_CODE_LENGTH;

  const submitCreate = (event: FormEvent): void => {
    event.preventDefault();
    if (!nameOk || busy !== null) return;
    onCreate();
  };

  const submitJoin = (event: FormEvent): void => {
    event.preventDefault();
    if (!nameOk || !codeOk || busy !== null) return;
    onJoin();
  };

  return (
    <main className="home">
      <header className="home__head">
        <h1 className="home__title">Backgammon</h1>
        <p className="home__tagline">
          Two players, one board, a doubling cube and a pile of chips that do not mean anything.
        </p>
        <span className="home__chips">
          <span className="home__chips-value">{chips}</span>
          <span className="home__chips-label">chips</span>
        </span>
      </header>

      <section className="card card--primary card--wide home__vs-computer">
        <h2 className="card__title">Play vs Computer</h2>
        <p className="card__foot">
          Starts right away against a computer opponent — no code to share, no waiting for a
          second player.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!nameOk || busy !== null || !online}
          onClick={onPlayComputer}
        >
          {busy === 'computer' ? <SpinnerIcon className="btn__spin" /> : null}
          Play vs Computer
        </button>
      </section>

      <section className="card card--wide home__jev">
        <h2 className="card__title">Jev vs Computer</h2>
        <p className="card__foot">
          Watch Jev, a TypeSafe System One model, play the computer. Every one of its decisions is
          shown as the choice it made, the options it weighed and how confident it was. You watch;
          you do not play.
        </p>
        <button
          type="button"
          className="btn btn--accent btn--block"
          disabled={!nameOk || busy !== null || !online}
          onClick={onWatchJev}
        >
          {busy === 'jev' ? <SpinnerIcon className="btn__spin" /> : null}
          Jev vs Computer
        </button>
      </section>

      <div className="home__grid">
        <form className="card card--primary" onSubmit={submitCreate}>
          <div className="field">
            <label className="field__label" htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className="field__input"
              type="text"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              placeholder="What your opponent sees"
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="field__label" id="stake-label">
              Chips per point
            </span>
            <div className="stakes" role="group" aria-labelledby="stake-label">
              {STAKE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={cx('stakes__chip', stake === preset && 'stakes__chip--on')}
                  aria-pressed={stake === preset}
                  onClick={() => onStakeChange(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              className="field__range"
              type="range"
              min={MIN_STAKE}
              max={MAX_STAKE}
              step={5}
              value={stake}
              aria-label="Chips per point"
              onChange={(e) => onStakeChange(Number(e.target.value))}
            />
            <p className="field__hint">
              A plain win costs {stake}. A gammon with the cube on 4 costs {stake * 8}.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={!nameOk || busy !== null || !online}
          >
            {busy === 'create' ? <SpinnerIcon className="btn__spin" /> : null}
            Create table
          </button>
          <p className="card__foot">You get a five character code to send to one other person.</p>
        </form>

        <form className="card" onSubmit={submitJoin}>
          <h2 className="card__title">Join a table</h2>
          <div className="field">
            <label className="field__label" htmlFor="room-code">
              Table code
            </label>
            <input
              id="room-code"
              className="field__input field__input--code"
              type="text"
              value={joinCode}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={ROOM_CODE_LENGTH}
              placeholder={'A'.repeat(ROOM_CODE_LENGTH)}
              aria-describedby="room-code-hint"
              onChange={(e) => onJoinCodeChange(e.target.value)}
            />
            <p className="field__hint" id="room-code-hint">
              {ROOM_CODE_LENGTH} characters, letters and numbers. Case does not matter.
            </p>
          </div>
          <button
            type="submit"
            className="btn btn--outline btn--block"
            disabled={!nameOk || !codeOk || busy !== null || !online}
          >
            {busy === 'join' ? <SpinnerIcon className="btn__spin" /> : null}
            Join table
          </button>
          <p className="card__foot">
            {online ? 'The stake is set by whoever made the table.' : 'Waiting for a connection.'}
          </p>
        </form>
      </div>
    </main>
  );
}
