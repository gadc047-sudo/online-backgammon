import { useCallback, useEffect, useRef, useState } from 'react';

import type { Move } from '../engine/types';
import { DEFAULT_STAKE } from '../shared/protocol';
import { GameScreen } from './components/GameScreen';
import { HomeScreen } from './components/HomeScreen';
import { Toasts } from './components/Toasts';
import { WaitingScreen } from './components/WaitingScreen';
import { useToasts } from './hooks/useToasts';
import {
  clearCodeFromUrl,
  codeFromUrl,
  defaultName,
  getPlayerId,
  getStoredChips,
  normaliseCode,
  setStoredChips,
  setStoredName,
} from './identity';
import { useSocket } from './useSocket';
import { seatOf } from './util';

export default function App(): JSX.Element {
  const [playerId] = useState(getPlayerId);
  const [name, setName] = useState(defaultName);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [joinCode, setJoinCode] = useState(() => codeFromUrl() ?? '');
  // Arriving on a share link means a specific table was meant, so do not resume
  // whatever room happened to still be in storage from last time.
  const [arrivedByLink] = useState(() => codeFromUrl() !== null);
  const [chips, setChips] = useState(getStoredChips);
  const [busy, setBusy] = useState<'create' | 'join' | 'computer' | null>(null);

  const nameRef = useRef(name);
  nameRef.current = name;

  const { toasts, pushError, pushNotice, dismiss } = useToasts();
  const socket = useSocket({
    playerId,
    nameRef,
    onError: pushError,
    onNotice: pushNotice,
    suppressResume: arrivedByLink,
  });
  const { snapshot } = socket;

  // A share link should prefill the code once and then stop haunting reloads.
  useEffect(() => {
    if (codeFromUrl() !== null) clearCodeFromUrl();
  }, []);

  useEffect(() => {
    setStoredName(name);
  }, [name]);

  // Home has no room and therefore no seat to read chips from. Remember the
  // last count we were told so the number there is real rather than invented.
  useEffect(() => {
    if (!snapshot) return;
    const seat = seatOf(snapshot, snapshot.you);
    if (!seat) return;
    setChips(seat.chips);
    setStoredChips(seat.chips);
  }, [snapshot]);

  const handleCreate = useCallback(async () => {
    setBusy('create');
    const res = await socket.createRoom(name.trim(), stake);
    setBusy(null);
    if (!res.ok) pushError(res.error ?? 'Could not open a table.');
  }, [name, pushError, socket, stake]);

  const handlePlayComputer = useCallback(async () => {
    setBusy('computer');
    const res = await socket.createRoomVsComputer(name.trim(), stake);
    setBusy(null);
    if (!res.ok) pushError(res.error ?? 'Could not start a game against the computer.');
  }, [name, pushError, socket, stake]);

  const handleJoin = useCallback(async () => {
    const code = normaliseCode(joinCode);
    setBusy('join');
    const res = await socket.joinRoom(name.trim(), code);
    setBusy(null);
    if (!res.ok) pushError(res.error ?? `No table with the code ${code}.`);
  }, [joinCode, name, pushError, socket]);

  const handleLeave = useCallback(async () => {
    await socket.leaveRoom();
    setJoinCode('');
  }, [socket]);

  const handleMove = useCallback(
    (move: Move) => {
      void socket.sendMove(move);
    },
    [socket],
  );

  const send = socket.send;
  const respondToCube = socket.respondToCube;

  const screen = ((): JSX.Element => {
    if (socket.resuming) {
      return (
        <main className="splash">
          <span className="splash__pulse" aria-hidden="true" />
          <p className="splash__text">Picking your table back up.</p>
        </main>
      );
    }

    if (snapshot === null) {
      return (
        <HomeScreen
          name={name}
          onNameChange={setName}
          stake={stake}
          onStakeChange={setStake}
          joinCode={joinCode}
          onJoinCodeChange={(next) => setJoinCode(normaliseCode(next))}
          chips={chips}
          busy={busy}
          online={socket.status === 'online'}
          onCreate={() => void handleCreate()}
          onPlayComputer={() => void handlePlayComputer()}
          onJoin={() => void handleJoin()}
        />
      );
    }

    if (snapshot.status === 'waiting') {
      return (
        <WaitingScreen
          code={snapshot.code}
          stake={snapshot.stake}
          onLeave={() => void handleLeave()}
          onCopyFailed={() => pushError('Could not reach the clipboard. Copy the code by hand.')}
        />
      );
    }

    return (
      <GameScreen
        snapshot={snapshot}
        connection={socket.status}
        onMove={handleMove}
        onOpeningRoll={() => void send('game:openingRoll')}
        onRoll={() => void send('game:roll')}
        onUndo={() => void send('game:undo')}
        onDone={() => void send('game:endTurn')}
        onDouble={() => void send('cube:double')}
        onResign={() => void send('game:resign')}
        onRematch={() => void send('game:rematch')}
        onCubeRespond={(accept) => void respondToCube(accept)}
        onLeave={() => void handleLeave()}
      />
    );
  })();

  return (
    <div className="app">
      {screen}
      <footer className="footer">
        <span className="footer__note">Play money only. Virtual chips have no value.</span>
      </footer>
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
