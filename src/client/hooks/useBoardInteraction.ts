/**
 * Tap-to-move and drag-to-move, driven entirely by `snapshot.legalMoves`.
 *
 * This is the whole of the client's rules integration: filter the server's
 * list. The client never decides what is legal, never re-derives a sequence and
 * never guesses at a die. If a move is not in the list the UI will not offer
 * it, and if the server later disagrees the next snapshot overwrites us.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Move, MovePoint } from '../../engine/types';
import { locationKey } from '../boardLayout';

export interface BoardInteraction {
  /** Origin currently chosen by tap, or being dragged. */
  readonly activeOrigin: MovePoint | null;
  readonly selected: MovePoint | null;
  readonly isDragging: boolean;
  /** Locations the player may pick a checker up from. */
  isOrigin(location: MovePoint): boolean;
  /** Locations highlighted right now as legal landings for the active origin. */
  isTarget(location: MovePoint): boolean;
  /** True once an origin is chosen, so untouchable points can be dimmed. */
  readonly hasActiveOrigin: boolean;
  tapLocation(location: MovePoint): void;
  beginDrag(location: MovePoint): boolean;
  endDrag(): void;
  dropOn(location: MovePoint): void;
  clear(): void;
}

/**
 * Bearing off can be legal with more than one die (an exact roll and any higher
 * roll, once nothing sits further back). Spending the smallest die that works
 * keeps the larger one available for a checker that may actually need it, which
 * is the play a human would nearly always want.
 */
function pickMove(candidates: readonly Move[]): Move | null {
  let best: Move | null = null;
  for (const move of candidates) {
    if (best === null || move.die < best.die) best = move;
  }
  return best;
}

export function useBoardInteraction(
  legalMoves: readonly Move[],
  onPlay: (move: Move) => void,
): BoardInteraction {
  const [selected, setSelected] = useState<MovePoint | null>(null);
  const [dragOrigin, setDragOrigin] = useState<MovePoint | null>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

  const byOrigin = useMemo(() => {
    const map = new Map<string, { location: MovePoint; moves: Move[] }>();
    for (const move of legalMoves) {
      const key = locationKey(move.from);
      const entry = map.get(key);
      if (entry) entry.moves.push(move);
      else map.set(key, { location: move.from, moves: [move] });
    }
    return map;
  }, [legalMoves]);

  /**
   * Changes exactly when the set of available plays changes, which is the only
   * moment selection should be reconsidered. An unrelated snapshot (an opponent
   * reconnecting, a log line) leaves the player's half-made choice alone.
   */
  const movesSignature = useMemo(
    () =>
      legalMoves
        .map((m) => `${locationKey(m.from)}>${locationKey(m.to)}:${m.die}`)
        .sort()
        .join('|'),
    [legalMoves],
  );

  // Read inside the signature effect without making it a dependency: the map is
  // derived from the same list the signature summarises.
  const byOriginRef = useRef(byOrigin);
  byOriginRef.current = byOrigin;

  useEffect(() => {
    setDragOrigin(null);
    // Checkers on the bar must re-enter before anything else moves, so the
    // server sends exactly one origin. Pre-selecting it makes that rule obvious
    // instead of leaving the player poking at frozen checkers.
    const entries = [...byOriginRef.current.values()];
    const only = entries.length === 1 ? entries[0] : undefined;
    setSelected(only ? only.location : null);
  }, [movesSignature]);

  const activeOrigin = dragOrigin ?? selected;

  const targets = useMemo(() => {
    if (activeOrigin === null) return new Set<string>();
    const entry = byOrigin.get(locationKey(activeOrigin));
    if (!entry) return new Set<string>();
    return new Set(entry.moves.map((m) => locationKey(m.to)));
  }, [activeOrigin, byOrigin]);

  const isOrigin = useCallback(
    (location: MovePoint) => byOrigin.has(locationKey(location)),
    [byOrigin],
  );

  const isTarget = useCallback(
    (location: MovePoint) => targets.has(locationKey(location)),
    [targets],
  );

  const play = useCallback(
    (from: MovePoint, to: MovePoint) => {
      const entry = byOrigin.get(locationKey(from));
      if (!entry) return;
      const toKey = locationKey(to);
      const move = pickMove(entry.moves.filter((m) => locationKey(m.to) === toKey));
      if (!move) return;
      setSelected(null);
      setDragOrigin(null);
      onPlayRef.current(move);
    },
    [byOrigin],
  );

  const clear = useCallback(() => {
    setSelected(null);
    setDragOrigin(null);
  }, []);

  const tapLocation = useCallback(
    (location: MovePoint) => {
      const key = locationKey(location);

      // Landing on a highlighted destination plays the move.
      if (activeOrigin !== null && locationKey(activeOrigin) !== key && targets.has(key)) {
        play(activeOrigin, location);
        return;
      }

      // Tapping the chosen origin again: play it outright if there is only one
      // place it can go, otherwise let go of it.
      if (selected !== null && locationKey(selected) === key) {
        const entry = byOrigin.get(key);
        const destinations = new Set(entry?.moves.map((m) => locationKey(m.to)) ?? []);
        if (entry && destinations.size === 1) {
          const first = entry.moves[0];
          if (first) play(location, first.to);
          return;
        }
        setSelected(null);
        return;
      }

      if (byOrigin.has(key)) {
        setSelected(location);
        return;
      }

      setSelected(null);
    },
    [activeOrigin, byOrigin, play, selected, targets],
  );

  const beginDrag = useCallback(
    (location: MovePoint) => {
      if (!byOrigin.has(locationKey(location))) return false;
      setSelected(location);
      setDragOrigin(location);
      return true;
    },
    [byOrigin],
  );

  const endDrag = useCallback(() => setDragOrigin(null), []);

  const dropOn = useCallback(
    (location: MovePoint) => {
      const origin = dragOrigin ?? selected;
      setDragOrigin(null);
      if (origin === null) return;
      if (!targets.has(locationKey(location))) {
        setSelected(origin);
        return;
      }
      play(origin, location);
    },
    [dragOrigin, play, selected, targets],
  );

  return {
    activeOrigin,
    selected,
    isDragging: dragOrigin !== null,
    hasActiveOrigin: activeOrigin !== null,
    isOrigin,
    isTarget,
    tapLocation,
    beginDrag,
    endDrag,
    dropOn,
    clear,
  };
}
