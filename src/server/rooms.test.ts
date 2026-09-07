import { describe, expect, it } from 'vitest';

import { legalMovesNow } from '../engine';
import type { DieValue, Move } from '../engine/types';
import { STARTING_CHIPS } from '../shared/protocol';
import { scriptedDice } from './dice';
import { RoomError, RoomRegistry, type Room } from './rooms';

const ALICE = 'player-alice';
const BOB = 'player-bob';
const CAROL = 'player-carol';

/**
 * Seats two players at a fresh table with scripted dice, so every test below is
 * deterministic. `dice` is consumed one value at a time: `rollDie` takes one and
 * `rollDice` takes two.
 */
function seatedRoom(dice: readonly DieValue[] = [6, 3, 5, 2, 4, 1]): {
  registry: RoomRegistry;
  room: Room;
} {
  const registry = new RoomRegistry(scriptedDice(dice));
  registry.createRoom(ALICE, 'Alice', 25);
  const created = registry.findRoomForPlayer(ALICE);
  if (!created) throw new Error('room was not created');
  const room = registry.joinRoom(created.code, BOB, 'Bob');
  return { registry, room };
}

/** Drives the opening roll until someone actually wins it. */
function resolveOpening(registry: RoomRegistry): Room {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    registry.openingRoll(ALICE);
    const room = registry.openingRoll(BOB);
    if (room.game?.phase === 'moving') return room;
  }
  throw new Error('opening roll never resolved');
}

describe('room lifecycle', () => {
  it('creates a table with one seated player and a share code', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    const room = registry.createRoom(ALICE, 'Alice', 25);

    expect(room.code).toHaveLength(5);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(room.seats).toHaveLength(1);
    expect(room.seats[0]?.player).toBe('white');
    expect(room.seats[0]?.chips).toBe(STARTING_CHIPS);
    expect(room.status).toBe('waiting');
    expect(room.game).toBeNull();
  });

  it('seats the joining player as black and starts the game', () => {
    const { room } = seatedRoom();

    expect(room.seats).toHaveLength(2);
    expect(room.seats[1]?.player).toBe('black');
    expect(room.status).toBe('playing');
    expect(room.game?.phase).toBe('opening-roll');
  });

  it('rejects an unknown code and a malformed code', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    expect(() => registry.joinRoom('ZZZZZ', BOB, 'Bob')).toThrow(RoomError);
    expect(() => registry.joinRoom('abc', BOB, 'Bob')).toThrow(/5 characters/);
  });

  it('refuses a third player', () => {
    const { registry, room } = seatedRoom();
    expect(() => registry.joinRoom(room.code, CAROL, 'Carol')).toThrow(/full/);
  });

  it('normalises a lower-case, space-padded code', () => {
    const { registry, room } = seatedRoom();
    const rejoined = registry.joinRoom(`  ${room.code.toLowerCase()} `, BOB, 'Bob');
    expect(rejoined.code).toBe(room.code);
  });

  it('clamps stake into the allowed band and defaults a blank name', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    const low = registry.createRoom(ALICE, '   ', 1);
    expect(low.stake).toBe(5);
    expect(low.seats[0]?.name).toBe('Player');

    const high = registry.createRoom(BOB, 'Bob', 9999);
    expect(high.stake).toBe(100);
  });
});

describe('vs-computer tables', () => {
  it('creates an instantly-playing table with a labelled computer seat', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    const room = registry.createVsComputerRoom(ALICE, 'Alice', 25);

    expect(room.seats).toHaveLength(2);
    expect(room.seats[0]?.isComputer).toBe(false);
    expect(room.seats[1]?.isComputer).toBe(true);
    expect(room.seats[1]?.name).toBe('Computer');
    expect(room.status).toBe('playing');
    expect(room.game?.phase).toBe('opening-roll');
  });

  it('lets the computer act through the exact same registry methods as a human', () => {
    const registry = new RoomRegistry(scriptedDice([3, 6]));
    const room = registry.createVsComputerRoom(ALICE, 'Alice', 25);
    const computerId = room.seats[1]?.playerId;
    if (!computerId) throw new Error('no computer seat');

    registry.openingRoll(ALICE);
    const afterComputerRoll = registry.openingRoll(computerId);
    expect(afterComputerRoll.game?.phase).toBe('moving');
  });

  it('tears the table down rather than parking a lone computer at "waiting"', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    const room = registry.createVsComputerRoom(ALICE, 'Alice', 25);

    registry.leaveRoom(ALICE);
    expect(registry.getRoom(room.code)).toBeUndefined();
    expect(registry.findRoomForPlayer(ALICE)).toBeUndefined();
  });

  it('never counts the computer seat as a reason to keep an idle table alive', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    const room = registry.createVsComputerRoom(ALICE, 'Alice', 25);
    registry.markDisconnected(ALICE);

    expect(registry.reap(Date.now() + 10 * 60 * 60 * 1000)).toBe(1);
    expect(registry.getRoom(room.code)).toBeUndefined();
  });
});

describe('reconnection', () => {
  it('holds the seat when a socket drops rather than forfeiting', () => {
    const { registry, room } = seatedRoom();
    resolveOpening(registry);
    const phaseBefore = registry.getRoom(room.code)?.game?.phase;

    const afterDrop = registry.markDisconnected(BOB);
    expect(afterDrop?.seats.find((s) => s.playerId === BOB)?.connected).toBe(false);
    expect(afterDrop?.game?.phase).toBe(phaseBefore);
    expect(afterDrop?.status).toBe('playing');
  });

  it('reclaims the same seat on rejoin and resyncs by snapshot', () => {
    const { registry, room } = seatedRoom();
    resolveOpening(registry);
    registry.markDisconnected(BOB);

    const rejoined = registry.joinRoom(room.code, BOB, 'Bob');
    expect(rejoined.seats).toHaveLength(2);
    expect(rejoined.seats.find((s) => s.playerId === BOB)?.player).toBe('black');
    expect(rejoined.seats.find((s) => s.playerId === BOB)?.connected).toBe(true);

    const snapshot = registry.snapshotFor(rejoined, BOB);
    expect(snapshot.you).toBe('black');
    expect(snapshot.game).not.toBeNull();
    expect(snapshot.code).toBe(room.code);
  });

  it('does not reap a room whose players are still connected', () => {
    const { registry } = seatedRoom();
    expect(registry.reap(Date.now() + 10 * 60 * 60 * 1000)).toBe(0);
  });

  it('reaps a room once everyone is gone and it has gone idle', () => {
    const { registry } = seatedRoom();
    registry.markDisconnected(ALICE);
    registry.markDisconnected(BOB);
    expect(registry.reap(Date.now() + 10 * 60 * 60 * 1000)).toBe(1);
    expect(registry.size).toBe(0);
  });
});

describe('server authority', () => {
  it('rejects a move from the player who is not on turn', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurn = room.game?.turn;
    const offTurnId = onTurn === 'white' ? BOB : ALICE;

    const fabricated: Move = { from: 13, to: 7, die: 6, hit: false };
    expect(() => registry.move(offTurnId, fabricated)).toThrow(/not your turn/i);
  });

  it('rejects an illegal move even when it is your turn', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurnId = room.game?.turn === 'white' ? ALICE : BOB;

    // Nothing can move 6 pips from an empty point with a die of 6 that the
    // player may not even hold.
    const illegal: Move = { from: 22, to: 16, die: 6, hit: false };
    expect(() => registry.move(onTurnId, illegal)).toThrow();
  });

  it('rejects rolling out of turn and rolling twice', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurnId = room.game?.turn === 'white' ? ALICE : BOB;
    const offTurnId = onTurnId === ALICE ? BOB : ALICE;

    expect(() => registry.roll(offTurnId)).toThrow(/not your turn/i);
    // The opening-roll winner is already in 'moving', so they cannot roll again.
    expect(() => registry.roll(onTurnId)).toThrow(/cannot roll/i);
  });

  it('will not end a turn while a legal move remains', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurnId = room.game?.turn === 'white' ? ALICE : BOB;

    expect(legalMovesNow(room.game!).length).toBeGreaterThan(0);
    expect(() => registry.endTurn(onTurnId)).toThrow(/still have a legal move/i);
  });

  it('substitutes its own canonical move rather than trusting the client', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurnId = room.game?.turn === 'white' ? ALICE : BOB;
    const legal = legalMovesNow(room.game!)[0];
    expect(legal).toBeDefined();

    // Claim a hit that is not there. The engine's canonical move wins.
    const lying: Move = { ...legal!, hit: !legal!.hit };
    const after = registry.move(onTurnId, lying);
    const played = after.game?.movesPlayed[0];
    expect(played?.hit).toBe(legal!.hit);
  });

  it('refuses actions from someone who is not at a table', () => {
    const { registry } = seatedRoom();
    expect(() => registry.roll(CAROL)).toThrow(/not at a table/i);
  });
});

describe('doubling cube and chip settlement', () => {
  it('offers, takes, and hands cube ownership to the taker', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const starter = room.game!.turn;
    const starterId = starter === 'white' ? ALICE : BOB;
    const responderId = starterId === ALICE ? BOB : ALICE;

    // Play out the opening turn so we reach an 'awaiting-roll' point.
    let current = registry.getRoom(room.code)!;
    while (current.game!.phase === 'moving' && legalMovesNow(current.game!).length > 0) {
      current = registry.move(starterId, legalMovesNow(current.game!)[0]!);
    }
    current = registry.endTurn(starterId);

    expect(current.game?.phase).toBe('awaiting-roll');
    expect(current.game?.turn).toBe(starter === 'white' ? 'black' : 'white');

    const doubled = registry.offerDouble(responderId);
    expect(doubled.game?.phase).toBe('cube-offered');
    expect(doubled.game?.cube.value).toBe(1);

    const taken = registry.respondToDouble(starterId, true);
    expect(taken.game?.cube.value).toBe(2);
    expect(taken.game?.cube.owner).toBe(starter);
    expect(taken.game?.phase).toBe('awaiting-roll');
    expect(taken.game?.turn).toBe(starter === 'white' ? 'black' : 'white');
  });

  it('settles chips to the offerer at the pre-double value when a double is passed', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const starter = room.game!.turn;
    const starterId = starter === 'white' ? ALICE : BOB;
    const responderId = starterId === ALICE ? BOB : ALICE;

    let current = registry.getRoom(room.code)!;
    while (current.game!.phase === 'moving' && legalMovesNow(current.game!).length > 0) {
      current = registry.move(starterId, legalMovesNow(current.game!)[0]!);
    }
    current = registry.endTurn(starterId);

    registry.offerDouble(responderId);
    const passed = registry.respondToDouble(starterId, false);

    expect(passed.status).toBe('game-over');
    expect(passed.lastResult?.points).toBe(1);
    // Stake 25, one point, cube still at 1 because the double was declined.
    expect(passed.lastResult?.chips).toBe(25);

    const offererSeat = passed.seats.find((s) => s.playerId === responderId);
    const passerSeat = passed.seats.find((s) => s.playerId === starterId);
    expect(offererSeat?.chips).toBe(STARTING_CHIPS + 25);
    expect(passerSeat?.chips).toBe(STARTING_CHIPS - 25);
  });

  it('settles a resignation and never lets a balance go negative', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);

    // Drain the resigning player so the clamp is exercised.
    const loserSeat = room.seats.find((s) => s.playerId === ALICE);
    if (loserSeat) loserSeat.chips = 10;

    const finished = registry.resign(ALICE);
    expect(finished.status).toBe('game-over');
    expect(finished.lastResult?.winner).toBe('black');
    expect(finished.lastResult?.chips).toBe(10);
    expect(finished.seats.find((s) => s.playerId === ALICE)?.chips).toBe(0);
    expect(finished.seats.find((s) => s.playerId === BOB)?.chips).toBe(STARTING_CHIPS + 10);
  });

  it('starts a fresh game only when both players ask for a rematch', () => {
    const { registry } = seatedRoom();
    resolveOpening(registry);
    registry.resign(ALICE);

    const first = registry.rematch(ALICE);
    expect(first.status).toBe('game-over');
    expect(first.rematchRequests.has('white')).toBe(true);

    const second = registry.rematch(BOB);
    expect(second.status).toBe('playing');
    expect(second.game?.phase).toBe('opening-roll');
    expect(second.game?.cube.value).toBe(1);
    expect(second.game?.cube.owner).toBeNull();
    expect(second.rematchRequests.size).toBe(0);
  });
});

describe('chip balances follow the player', () => {
  it('carries a balance to the next table instead of resetting it', () => {
    const { registry } = seatedRoom();
    resolveOpening(registry);
    const finished = registry.resign(ALICE);
    expect(finished.seats.find((s) => s.playerId === BOB)?.chips).toBe(STARTING_CHIPS + 25);

    // Both leave and sit down at a brand new table.
    registry.leaveRoom(ALICE);
    registry.leaveRoom(BOB);

    const fresh = registry.createRoom(BOB, 'Bob', 25);
    expect(fresh.seats[0]?.chips).toBe(STARTING_CHIPS + 25);
    const rejoined = registry.joinRoom(fresh.code, ALICE, 'Alice');
    expect(rejoined.seats.find((s) => s.playerId === ALICE)?.chips).toBe(STARTING_CHIPS - 25);
  });

  it('seeds an unknown player at the starting stack', () => {
    const registry = new RoomRegistry(scriptedDice([3]));
    expect(registry.chipsFor('nobody')).toBe(STARTING_CHIPS);
  });
});

describe('per-recipient snapshots', () => {
  it('gives legal moves only to the player on turn', () => {
    const { registry } = seatedRoom();
    const room = resolveOpening(registry);
    const onTurn = room.game!.turn;

    const aliceView = registry.snapshotFor(room, ALICE);
    const bobView = registry.snapshotFor(room, BOB);

    const activeView = onTurn === 'white' ? aliceView : bobView;
    const idleView = onTurn === 'white' ? bobView : aliceView;

    expect(activeView.legalMoves.length).toBeGreaterThan(0);
    expect(idleView.legalMoves).toHaveLength(0);
    expect(idleView.canEndTurn).toBe(false);
    expect(aliceView.you).toBe('white');
    expect(bobView.you).toBe('black');
  });

  it('reports no seat for an unrelated player id', () => {
    const { registry, room } = seatedRoom();
    const view = registry.snapshotFor(room, CAROL);
    expect(view.you).toBeNull();
    expect(view.legalMoves).toHaveLength(0);
    expect(view.canDouble).toBe(false);
  });
});
