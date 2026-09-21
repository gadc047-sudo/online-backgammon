import type { GameState } from '../../engine/types';
import type { RoomSnapshot } from '../../shared/protocol';
import { diceFaces } from '../util';
import { DiceRow } from './Dice';

interface SpectatorPanelProps {
  readonly snapshot: RoomSnapshot;
  readonly game: GameState;
  readonly bottomName: string;
  readonly topName: string;
  readonly onLeave: () => void;
}

/**
 * What a watcher sees in place of the control panel.
 *
 * `ControlPanel` is written around "you" — your roll, your dice, your turn —
 * and a spectator has no seat, so rather than thread a null player through
 * every one of its branches this renders the same phase state from the
 * outside. It has no buttons that act on the game, which is the point: the
 * server would reject them anyway, since an unseated caller fails `context()`.
 */
export function SpectatorPanel(props: SpectatorPanelProps): JSX.Element {
  const { snapshot, game, bottomName, topName, onLeave } = props;
  const nameFor = (player: GameState['turn']): string =>
    player === 'white' ? bottomName : topName;

  const body = ((): JSX.Element => {
    switch (game.phase) {
      case 'opening-roll':
        return (
          <>
            <p className="panel__headline">Opening roll</p>
            <p className="panel__sub">
              Both players roll one die. The higher die plays first, using both dice.
            </p>
          </>
        );

      case 'awaiting-roll':
        return (
          <>
            <p className="panel__headline panel__headline--wait">{nameFor(game.turn)} to roll</p>
            <p className="panel__sub">
              {snapshot.stake} chips a point, cube on {game.cube.value}.
            </p>
          </>
        );

      case 'moving':
        return (
          <>
            <p className="panel__headline panel__headline--wait">{nameFor(game.turn)} is moving</p>
            <DiceRow faces={diceFaces(game)} owner={game.turn} size="lg" />
            <p className="panel__sub">
              {game.movesPlayed.length} of {game.dice.length} played this turn.
            </p>
          </>
        );

      case 'cube-offered':
        return (
          <>
            <p className="panel__headline">Double offered</p>
            <p className="panel__sub">
              {nameFor(game.turn)} must take the cube at {game.cube.value * 2} or drop the game.
            </p>
          </>
        );

      case 'game-over':
      default:
        return (
          <>
            <p className="panel__headline">Game over</p>
            <p className="panel__sub">A new game starts on its own.</p>
          </>
        );
    }
  })();

  return (
    <section className="panel" aria-label="Table status">
      <div className="panel__body">
        <p className="panel__eyebrow">Watching</p>
        {body}
      </div>
      <div className="panel__foot">
        <button type="button" className="btn btn--quiet btn--sm" onClick={onLeave}>
          Leave
        </button>
        <span className="panel__foot-note">You are watching. You cannot move.</span>
      </div>
    </section>
  );
}
