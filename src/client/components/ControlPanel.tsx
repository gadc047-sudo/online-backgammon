import { useEffect, useState } from 'react';

import { nextCubeValue } from '../../engine/cube';
import type { GameState, Player } from '../../engine/types';
import type { RoomSnapshot } from '../../shared/protocol';
import { cx, diceFaces, otherPlayer, plural } from '../util';
import { Die, DiceRow } from './Dice';

interface ControlPanelProps {
  readonly snapshot: RoomSnapshot;
  readonly game: GameState;
  readonly you: Player | null;
  readonly youName: string;
  readonly opponentName: string;
  readonly onOpeningRoll: () => void;
  readonly onRoll: () => void;
  readonly onUndo: () => void;
  readonly onDone: () => void;
  readonly onDouble: () => void;
  readonly onResign: () => void;
}

const RESIGN_ARM_MS = 6_000;

/**
 * Everything the player can do right now, driven off `game.phase` — the same
 * state machine the server runs. Nothing here decides anything; it renders the
 * server's `canDouble` / `canEndTurn` / `legalMoves` verbatim.
 */
export function ControlPanel(props: ControlPanelProps): JSX.Element {
  const {
    snapshot,
    game,
    you,
    youName,
    opponentName,
    onOpeningRoll,
    onRoll,
    onUndo,
    onDone,
    onDouble,
    onResign,
  } = props;

  const [resignArmed, setResignArmed] = useState(false);

  useEffect(() => {
    if (!resignArmed) return undefined;
    const timer = window.setTimeout(() => setResignArmed(false), RESIGN_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [resignArmed]);

  const yourTurn = you !== null && game.turn === you;
  const seated = you !== null;
  const faces = diceFaces(game);
  const diceOwner: Player = game.turn;
  // The rule new players miss: nothing else moves while you are on the bar.
  const onBar = you === null ? 0 : game.board.bar[you];

  /**
   * A decided opening roll leaves `opening-roll` in the same transition, so the
   * result is only ever visible on the turn it produced. Recognise that turn
   * rather than repeating the footnote for the rest of the game: nothing has
   * been played, and the live roll is exactly the two opening dice.
   */
  const openingSummary = ((): JSX.Element | null => {
    const white = game.openingRolls.white;
    const black = game.openingRolls.black;
    if (white === undefined || black === undefined || white === black) return null;
    if (game.movesPlayed.length > 0 || game.roll === null) return null;
    if (game.roll[0] !== Math.max(white, black) || game.roll[1] !== Math.min(white, black)) {
      return null;
    }
    const starter: Player = white > black ? 'white' : 'black';
    const starterName = you !== null && starter === you ? youName : opponentName;
    return (
      <p className="panel__note">
        Opening roll <Die value={white} owner="white" /> <Die value={black} owner="black" /> —{' '}
        {starterName} plays first.
      </p>
    );
  })();

  const body = ((): JSX.Element => {
    switch (game.phase) {
      case 'opening-roll': {
        const yourDie = you === null ? undefined : game.openingRolls[you];
        const theirDie = you === null ? undefined : game.openingRolls[otherPlayer(you)];
        return (
          <>
            <p className="panel__headline">Roll for first move</p>
            <p className="panel__sub">
              Both players roll one die. The higher die plays first, using both dice. Matching dice
              are re-rolled.
            </p>
            <div className="opening">
              <div className="opening__side">
                <span className="opening__label">{youName}</span>
                {yourDie === undefined ? (
                  <span className="opening__blank" aria-label="Not rolled yet" />
                ) : (
                  <Die value={yourDie} owner={you ?? 'white'} size="lg" />
                )}
              </div>
              <div className="opening__side">
                <span className="opening__label">{opponentName}</span>
                {theirDie === undefined ? (
                  <span className="opening__blank" aria-label="Not rolled yet" />
                ) : (
                  <Die value={theirDie} owner={you === null ? 'black' : otherPlayer(you)} size="lg" />
                )}
              </div>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!seated || yourDie !== undefined}
                onClick={onOpeningRoll}
              >
                {yourDie === undefined ? 'Roll for first move' : 'Waiting for your opponent'}
              </button>
            </div>
          </>
        );
      }

      case 'awaiting-roll': {
        if (!yourTurn) {
          return (
            <>
              <p className="panel__headline panel__headline--wait">
                {opponentName} is about to roll
              </p>
              <p className="panel__sub">Nothing to do. The board updates the moment they play.</p>
            </>
          );
        }
        return (
          <>
            <p className="panel__headline">Your roll</p>
            <p className="panel__sub">
              {onBar > 0
                ? `You have ${onBar} ${plural(onBar, 'checker', 'checkers')} on the bar. Roll, then re-enter before anything else can move.`
                : snapshot.canDouble
                  ? `Double before you roll to raise the cube to ${nextCubeValue(game.cube.value)}.`
                  : 'Roll the dice to start your turn.'}
            </p>
            <div className="panel__actions">
              <button type="button" className="btn btn--primary" onClick={onRoll}>
                Roll
              </button>
              {snapshot.canDouble ? (
                <button type="button" className="btn btn--cube" onClick={onDouble}>
                  Double to {nextCubeValue(game.cube.value)}
                </button>
              ) : null}
            </div>
          </>
        );
      }

      case 'moving': {
        if (!yourTurn) {
          return (
            <>
              <p className="panel__headline panel__headline--wait">{opponentName} is moving</p>
              <DiceRow faces={faces} owner={diceOwner} size="lg" />
              <p className="panel__sub">Their checkers will move as they play each die.</p>
            </>
          );
        }
        const played = game.movesPlayed.length;
        const stuck = snapshot.legalMoves.length === 0;
        const headline = stuck
          ? played === 0
            ? 'No legal move'
            : 'Turn complete'
          : onBar > 0
            ? 'Enter from the bar'
            : 'Move your checkers';
        const sub = stuck
          ? played === 0
            ? 'Nothing you own can play either die. Press Done to pass the turn.'
            : 'Every die that can be played has been. Press Done to hand over.'
          : onBar === 1
            ? 'One of your checkers is on the bar. Nothing else may move until it is back on the board.'
            : onBar > 1
              ? `${onBar} of your checkers are on the bar. Nothing else may move until they are back on the board.`
              : 'Tap a checker to see where it can go, or drag it. Only legal landings light up.';
        return (
          <>
            <p
              className={cx(
                'panel__headline',
                stuck && 'panel__headline--stuck',
                !stuck && onBar > 0 && 'panel__headline--bar',
              )}
            >
              {headline}
            </p>
            <DiceRow faces={faces} owner={diceOwner} size="lg" />
            <p className="panel__sub">{sub}</p>
            {openingSummary}
            <div className="panel__actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={played === 0}
                onClick={onUndo}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!snapshot.canEndTurn}
                onClick={onDone}
              >
                Done
              </button>
            </div>
          </>
        );
      }

      case 'cube-offered': {
        const responder = game.turn;
        if (you !== null && responder === you) {
          return (
            <>
              <p className="panel__headline">{opponentName} doubled</p>
              <p className="panel__sub">Answer the double to carry on.</p>
            </>
          );
        }
        return (
          <>
            <p className="panel__headline panel__headline--wait">Double offered</p>
            <p className="panel__sub">
              Waiting for {opponentName} to take the cube at {nextCubeValue(game.cube.value)} or
              drop the game.
            </p>
          </>
        );
      }

      case 'game-over':
      default:
        return (
          <>
            <p className="panel__headline">Game over</p>
            <p className="panel__sub">The result is on the board.</p>
          </>
        );
    }
  })();

  const showResign = game.phase !== 'game-over' && seated;

  return (
    <section className="panel" aria-label="Your controls">
      <div className="panel__body">{body}</div>
      {showResign ? (
        <div className="panel__foot">
          {resignArmed ? (
            <>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => {
                  setResignArmed(false);
                  onResign();
                }}
              >
                Confirm resign
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => setResignArmed(false)}
              >
                Keep playing
              </button>
              <span className="panel__foot-note">
                Hands {opponentName} {game.cube.value}{' '}
                {plural(game.cube.value, 'point', 'points')}.
              </span>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => setResignArmed(true)}
            >
              Resign
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
