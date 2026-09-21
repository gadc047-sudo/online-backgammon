import { pipCount } from '../../engine/board';
import type { Move, Player } from '../../engine/types';
import type { RoomSnapshot } from '../../shared/protocol';
import { useBoardInteraction } from '../hooks/useBoardInteraction';
import type { ConnectionStatus } from '../useSocket';
import { nameOf, otherPlayer, seatOf } from '../util';
import { Board } from './Board';
import { ConnectionBadge } from './ConnectionBadge';
import { ControlPanel } from './ControlPanel';
import { CubeOfferModal } from './CubeOfferModal';
import { GameLog } from './GameLog';
import { JevPanel } from './JevPanel';
import { PlayerRail } from './PlayerRail';
import { ResultBanner } from './ResultBanner';
import { SpectatorPanel } from './SpectatorPanel';

interface GameScreenProps {
  readonly snapshot: RoomSnapshot;
  readonly connection: ConnectionStatus;
  readonly onMove: (move: Move) => void;
  readonly onOpeningRoll: () => void;
  readonly onRoll: () => void;
  readonly onUndo: () => void;
  readonly onDone: () => void;
  readonly onDouble: () => void;
  readonly onResign: () => void;
  readonly onRematch: () => void;
  readonly onCubeRespond: (accept: boolean) => void;
  readonly onLeave: () => void;
}

export function GameScreen(props: GameScreenProps): JSX.Element {
  const {
    snapshot,
    connection,
    onMove,
    onOpeningRoll,
    onRoll,
    onUndo,
    onDone,
    onDouble,
    onResign,
    onRematch,
    onCubeRespond,
    onLeave,
  } = props;

  // Hooks run before any early return, so a snapshot without a game is fine.
  const interaction = useBoardInteraction(snapshot.legalMoves, onMove);

  const you = snapshot.you;
  /**
   * A watcher has no seat, so the board falls back to white — which is exactly
   * why the Jev seat is white: white renders at the bottom, and the locked
   * requirement is that Jev is always the bottom seat.
   */
  const spectating = you === null;
  const viewer: Player = you ?? 'white';
  const opponent = otherPlayer(viewer);
  const youSeat = seatOf(snapshot, you);
  const opponentSeat = seatOf(snapshot, opponent);
  const youName = nameOf(youSeat, 'You');
  const opponentName = nameOf(opponentSeat, 'Your opponent');
  const game = snapshot.game;

  const header = (
    <header className="game__head">
      {snapshot.mode === 'jev-demo' ? (
        <span className="game__code game__code--demo">Jev vs Computer</span>
      ) : (
        <span className="game__code" aria-label={`Table code ${snapshot.code}`}>
          {snapshot.code}
        </span>
      )}
      <span className="game__stake">{snapshot.stake} chips a point</span>
      <ConnectionBadge
        status={connection}
        opponentConnected={opponentSeat ? opponentSeat.connected : null}
        opponentName={opponentName}
      />
      <button type="button" className="btn btn--quiet btn--sm game__leave" onClick={onLeave}>
        Leave
      </button>
    </header>
  );

  if (game === null) {
    return (
      <main className="game">
        {header}
        <p className="game__pending">Setting the board up.</p>
      </main>
    );
  }

  const yourTurn = you !== null && game.turn === you && game.phase !== 'game-over';
  const isOver = game.phase === 'game-over' || snapshot.status === 'game-over';
  const cubeOfferedToYou =
    game.phase === 'cube-offered' && you !== null && game.turn === you && !isOver;

  return (
    <main className="game">
      {header}

      <div className="game__grid">
        <div className="game__main">
          <PlayerRail
            seat={opponentSeat}
            player={opponent}
            isYou={false}
            isTurn={!isOver && game.turn === opponent}
            pip={pipCount(game.board, opponent)}
            borneOff={game.board.off[opponent]}
            onBar={game.board.bar[opponent]}
          />

          <div
            className="stage"
            onClick={(event) => {
              // Tapping the felt around the board lets go of a chosen checker.
              if (event.target === event.currentTarget) interaction.clear();
            }}
          >
            <Board game={game} viewer={viewer} interaction={interaction} isYourTurn={yourTurn} />
            {isOver ? (
              <ResultBanner
                result={snapshot.lastResult}
                game={game}
                you={you}
                youSeat={youSeat}
                opponentSeat={opponentSeat}
                rematchRequestedBy={snapshot.rematchRequestedBy}
                canRematch={!spectating || snapshot.mode === 'jev-demo'}
                rematchLabel={spectating ? 'Watch another game' : undefined}
                onRematch={onRematch}
                onLeave={onLeave}
              />
            ) : null}
          </div>

          <PlayerRail
            seat={youSeat}
            player={viewer}
            isYou={you !== null}
            isTurn={yourTurn}
            pip={pipCount(game.board, viewer)}
            borneOff={game.board.off[viewer]}
            onBar={game.board.bar[viewer]}
          />
        </div>

        <aside className="game__side">
          {snapshot.jev ? <JevPanel jev={snapshot.jev} /> : null}
          {spectating ? (
            <SpectatorPanel
              snapshot={snapshot}
              game={game}
              bottomName={youName}
              topName={opponentName}
              onLeave={onLeave}
            />
          ) : (
          <ControlPanel
            snapshot={snapshot}
            game={game}
            you={you}
            youName={youName}
            opponentName={opponentName}
            onOpeningRoll={onOpeningRoll}
            onRoll={onRoll}
            onUndo={onUndo}
            onDone={onDone}
            onDouble={onDouble}
            onResign={onResign}
          />
          )}
          <GameLog entries={snapshot.log} />
        </aside>
      </div>

      {cubeOfferedToYou ? (
        <CubeOfferModal
          cube={game.cube}
          stake={snapshot.stake}
          offererName={opponentName}
          onTake={() => onCubeRespond(true)}
          onPass={() => onCubeRespond(false)}
        />
      ) : null}
    </main>
  );
}
