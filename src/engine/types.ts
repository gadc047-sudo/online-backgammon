/**
 * Core types for the backgammon rules engine.
 *
 * Purity contract (CLAUDE.md principle 2): nothing in `src/engine` may perform
 * I/O, touch the network, import a framework, or read a clock/RNG. Every
 * function here is deterministic given its arguments.
 *
 * Board geometry
 * --------------
 * Points are numbered 1..24 in absolute terms and never re-indexed per player.
 *
 *   - `white` moves from HIGH points to LOW points (24 -> 1) and bears off past 1.
 *     White's home board is points 1..6.
 *   - `black` moves from LOW points to HIGH points (1 -> 24) and bears off past 24.
 *     Black's home board is points 19..24.
 *
 * A checker's "distance to bearing off" is therefore `p` for white and `25 - p`
 * for black; a checker on the bar is always at distance 25. This single
 * asymmetry is the only place direction is encoded — see `distanceToOff`.
 */

export type Player = 'white' | 'black';

export const PLAYERS: readonly Player[] = ['white', 'black'] as const;

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export type CubeValue = 1 | 2 | 4 | 8 | 16 | 32 | 64;

/** A location a checker can occupy during a move: a point, the bar, or borne off. */
export type MovePoint = number | 'bar' | 'off';

/** A single checker hop consuming exactly one die. */
export interface Move {
  readonly from: MovePoint;
  readonly to: MovePoint;
  readonly die: DieValue;
  /** True when this hop sends a lone opposing checker to the bar. */
  readonly hit: boolean;
}

export interface PointState {
  /** null when the point is empty; `count` is then 0. */
  readonly color: Player | null;
  readonly count: number;
}

export interface BoardState {
  /** Length 24. `points[i]` describes point number `i + 1`. */
  readonly points: readonly PointState[];
  readonly bar: Readonly<Record<Player, number>>;
  readonly off: Readonly<Record<Player, number>>;
}

/**
 * Turn/cube state machine (CLAUDE.md principle 3). A cube offer interrupts
 * normal turn flow, so `cube-offered` is a first-class phase, not a flag.
 *
 *   opening-roll ──> moving (opening roll winner plays the two opening dice)
 *   awaiting-roll ──> moving ──> (endTurn) ──> awaiting-roll
 *   awaiting-roll ──> cube-offered ──> awaiting-roll (take) | game-over (pass)
 *   any ──> game-over
 */
export type GamePhase =
  | 'opening-roll'
  | 'awaiting-roll'
  | 'moving'
  | 'cube-offered'
  | 'game-over';

export type WinType = 'single' | 'gammon' | 'backgammon';

/** How the game ended. `resign` and `pass` settle at the current cube value. */
export type WinReason = 'bear-off' | 'cube-pass' | 'resign';

export interface CubeState {
  readonly value: CubeValue;
  /** null means the cube is centred and either player may double. */
  readonly owner: Player | null;
}

export interface GameState {
  readonly board: BoardState;
  readonly phase: GamePhase;
  /** The player who must act next. During `cube-offered` this is the responder. */
  readonly turn: Player;
  readonly cube: CubeState;

  /** The raw dice as rolled, e.g. [6, 3] or [4, 4]. null outside `moving`. */
  readonly roll: readonly [DieValue, DieValue] | null;
  /** Die values still available this turn. Doubles expand to four entries. */
  readonly dice: readonly DieValue[];
  /** Moves committed so far this turn, in order. Already applied to `board`. */
  readonly movesPlayed: readonly Move[];
  /**
   * Board snapshot taken when the dice were rolled. Legal sequences are always
   * enumerated from here, because "must play both dice" and "must play the
   * higher die" only resolve across a whole turn, never hop-by-hop.
   */
  readonly turnStartBoard: BoardState | null;

  /** Opening roll: one die per player. Equal dice are discarded and re-rolled. */
  readonly openingRolls: Readonly<Partial<Record<Player, DieValue>>>;

  /** Set while `phase === 'cube-offered'`. */
  readonly cubeOfferedBy: Player | null;

  readonly winner: Player | null;
  readonly winType: WinType | null;
  readonly winReason: WinReason | null;
}

/** Thrown by every engine mutator when asked to do something illegal. */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}
