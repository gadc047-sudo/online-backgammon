import { pointAt } from '../../engine/board';
import type { GameState, Player } from '../../engine/types';
import { boardSlots, gridColumnForSlot, isViewerHome } from '../boardLayout';
import type { BoardInteraction } from '../hooks/useBoardInteraction';
import { cx, otherPlayer } from '../util';
import { BarZone } from './BarZone';
import { CubeToken } from './CubeToken';
import { OffTray } from './OffTray';
import { Point } from './Point';

interface BoardProps {
  readonly game: GameState;
  /** Seat the board is drawn from. Spectators get white's view. */
  readonly viewer: Player;
  readonly interaction: BoardInteraction;
  readonly isYourTurn: boolean;
}

/**
 * The board.
 *
 * Sizing is entirely proportional: the frame owns a fixed aspect ratio and a
 * container-query context, the grid divides it into fourteen columns and five
 * rows, and every checker, badge and label is a percentage or a cqw of that.
 * Nothing inside is measured in px, so the same markup reads at 360 CSS px on a
 * phone and at 1100 on a desktop.
 */
export function Board(props: BoardProps): JSX.Element {
  const { game, viewer, interaction, isYourTurn } = props;
  const opponent = otherPlayer(viewer);
  const slots = boardSlots(viewer);
  const board = game.board;

  const muted = interaction.hasActiveOrigin;

  const renderRow = (points: readonly number[], row: 'top' | 'bottom'): JSX.Element[] =>
    points.map((point, index) => {
      const state = pointAt(board, point);
      return (
        <Point
          key={point}
          point={point}
          color={state.color}
          count={state.count}
          row={row}
          index={index}
          isHome={isViewerHome(viewer, point)}
          isOrigin={interaction.isOrigin(point)}
          isSelected={
            interaction.activeOrigin !== null && interaction.activeOrigin === point
          }
          isTarget={interaction.isTarget(point)}
          isMuted={muted && !interaction.isTarget(point) && interaction.activeOrigin !== point}
          onTap={() => interaction.tapLocation(point)}
          onDragStart={() => interaction.beginDrag(point)}
          onDragEnd={interaction.endDrag}
          onDrop={() => interaction.dropOn(point)}
        />
      );
    });

  const renderLabels = (points: readonly number[], gridRow: number): JSX.Element[] =>
    points.map((point, index) => (
      <span
        key={point}
        className="pt-label"
        style={{ gridColumn: gridColumnForSlot(index), gridRow }}
        aria-hidden="true"
      >
        {point}
      </span>
    ));

  const offIsTarget = interaction.isTarget('off');

  return (
    <div className={cx('board-frame', isYourTurn && 'board-frame--active')}>
      <div className="board">
        {renderLabels(slots.top, 1)}
        {renderRow(slots.top, 'top')}

        <div className="bar" style={{ gridColumn: 7, gridRow: '2 / 5' }}>
          <BarZone
            side="top"
            color={viewer}
            count={board.bar[viewer]}
            isYours
            isOrigin={interaction.isOrigin('bar')}
            isSelected={interaction.activeOrigin === 'bar'}
            isMuted={muted && interaction.activeOrigin !== 'bar'}
            onTap={() => interaction.tapLocation('bar')}
            onDragStart={() => interaction.beginDrag('bar')}
            onDragEnd={interaction.endDrag}
          />
          <CubeToken cube={game.cube} viewer={viewer} />
          <BarZone
            side="bottom"
            color={opponent}
            count={board.bar[opponent]}
            isYours={false}
            isOrigin={false}
            isSelected={false}
            isMuted={false}
            onTap={() => undefined}
            onDragStart={() => undefined}
            onDragEnd={() => undefined}
          />
        </div>

        <OffTray
          side="top"
          color={opponent}
          count={board.off[opponent]}
          isYours={false}
          isTarget={false}
          isMuted={muted}
          onTap={() => interaction.clear()}
          onDrop={() => undefined}
        />
        <OffTray
          side="bottom"
          color={viewer}
          count={board.off[viewer]}
          isYours
          isTarget={offIsTarget}
          isMuted={muted && !offIsTarget}
          onTap={() => interaction.tapLocation('off')}
          onDrop={() => interaction.dropOn('off')}
        />

        {renderRow(slots.bottom, 'bottom')}
        {renderLabels(slots.bottom, 5)}
      </div>
    </div>
  );
}
