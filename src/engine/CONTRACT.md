# Rules engine contract

Authoritative signature + semantics spec. `src/engine/types.ts` and
`src/engine/index.ts` already exist and are **FROZEN** — do not edit them.
Implement exactly the exports below, in exactly these files.

Purity: no I/O, no RNG, no clock, no framework imports, no imports from
`../server`, `../client`, or `../shared`. Every function is pure; every mutator
returns a NEW state and never mutates its argument.

Geometry recap: points 1..24 absolute. `white` moves 24 -> 1 and bears off past
1 (home = 1..6). `black` moves 1 -> 24 and bears off past 24 (home = 19..24).

---

## `src/engine/board.ts`

```ts
export function initialBoard(): BoardState
```
Standard opening position. White: 2 on 24, 5 on 13, 3 on 8, 5 on 6.
Black: 2 on 1, 5 on 12, 3 on 17, 5 on 19. Bar and off all zero.

```ts
export function emptyBoard(): BoardState
```
24 empty points, bar/off zero. For test fixtures.

```ts
export function makeBoard(spec: {
  white?: Record<number, number>;   // point number -> checker count
  black?: Record<number, number>;
  whiteBar?: number; blackBar?: number;
  whiteOff?: number; blackOff?: number;
}): BoardState
```
Test fixture helper. Throws if a point is given to both colours.

```ts
export function pointAt(board: BoardState, point: number): PointState
```
1-indexed. Throws `RangeError` outside 1..24.

```ts
export function distanceToOff(player: Player, at: MovePoint): number
```
`'bar'` -> 25. `'off'` -> 0. White -> `at`. Black -> `25 - at`.

```ts
export function moveDistance(player: Player, from: MovePoint, to: MovePoint): number
```
`distanceToOff(player, from) - distanceToOff(player, to)`. Positive for a legal
direction of travel.

```ts
export function entryPoint(player: Player, die: DieValue): number
```
White: `25 - die` (die 1 -> point 24). Black: `die` (die 1 -> point 1).

```ts
export function homeBoardPoints(player: Player): number[]
```
White `[1,2,3,4,5,6]`, black `[19,20,21,22,23,24]`.

```ts
export function isBlocked(board: BoardState, player: Player, point: number): boolean
```
True when `point` holds 2 or more opposing checkers.

```ts
export function checkersOnBoard(board: BoardState, player: Player): number
export function allCheckersHome(board: BoardState, player: Player): boolean
export function pipCount(board: BoardState, player: Player): number
```
`allCheckersHome` is true when the player has no checkers on the bar and none
outside their home board. Borne-off checkers do not count against it.
`pipCount` sums `distanceToOff` over that player's checkers on points and bar;
borne-off checkers contribute 0. Opening position pip count is 167 for each side.

```ts
export function cloneBoard(board: BoardState): BoardState
export function boardKey(board: BoardState): string
```
`boardKey` is a canonical string used to dedupe identical positions during search.

```ts
export function applyMoveToBoard(board: BoardState, player: Player, move: Move): BoardState
```
Applies one hop. Removes a checker from `move.from` (bar counter if `'bar'`),
places it on `move.to` (off counter if `'off'`). If `move.hit`, the single
opposing checker on `move.to` goes to the opponent's bar first. Does NOT
validate legality — callers only pass moves produced by `moves.ts`. Pure.

```ts
export function winTypeFor(board: BoardState, winner: Player): WinType
```
Given the winner has borne off 15: `'backgammon'` if the loser has borne off
zero AND has at least one checker on the bar or in the WINNER's home board;
`'gammon'` if the loser has borne off zero otherwise; else `'single'`.

---

## `src/engine/moves.ts`

```ts
export function expandDice(roll: readonly [DieValue, DieValue]): DieValue[]
```
Non-doubles -> `[a, b]`. Doubles -> four copies.

```ts
export function legalSequences(
  board: BoardState, player: Player, dice: readonly DieValue[],
): Move[][]
```
THE core function. Returns every MAXIMAL legal sequence of hops for the turn,
enumerated from a turn-start board. These rules must fall out of the generator,
not out of special cases elsewhere:

1. **Bar first.** While the player has checkers on the bar, the only legal moves
   are entries from the bar onto `entryPoint(player, die)`, and only if that
   point is not blocked.
2. **Landing legality.** A checker may land on a point that is empty, holds its
   own colour, or holds exactly one opposing checker (a hit, `hit: true`).
3. **Maximise dice used.** Compute the greatest achievable sequence length L and
   return ONLY sequences of length L. A turn where zero moves are possible
   returns `[[]]` (one empty sequence), never `[]`.
4. **Higher die preference.** If L === 1 and the roll is not doubles, and some
   length-1 sequence uses the higher die, discard every sequence that uses only
   the lower die.
5. **Bearing off.** Legal only when `allCheckersHome(board, player)`. A checker
   at distance `d` bears off with a die equal to `d`; with a die `> d` only when
   no checker of that player sits at a distance greater than `d`. A die `< d`
   may never bear that checker off (it may still move it within the home board).
6. **Doubles** yield up to four hops.

Dedupe: two sequences that are permutations producing the identical board are
the same play — dedupe so the returned list holds no duplicate play. Search must
memoise by `(boardKey, remaining-dice multiset)` to stay fast on doubles.

Performance requirement: worst-case doubles from any reachable position must
complete in well under 100ms.

```ts
export function legalContinuations(
  board: BoardState, player: Player, dice: readonly DieValue[],
  movesPlayed: readonly Move[],
): Move[]
```
`board` is the TURN-START board, `dice` the full expanded roll. Returns the
deduped set of hops the player may make next. Empty array when the turn is
finished. Throws `IllegalMoveError` if `movesPlayed` is not a legal prefix.

**Do not implement this by prefix-filtering `legalSequences`.** That function
collapses permutations reaching the same board into one representative play, so
filtering its output forbids legal hops purely because a different ordering was
picked as the representative. A concrete case: white to play 5 and 3 with
`white {24:2, 13:5, 8:3, 6:5}` against `black {19:5, 17:3, 12:5, 5:1, 1:1}` — the
hit 8/5 is a legal way to open the turn, but no representative play begins with
it, so prefix-filtering rejects it and the player simply cannot make the move.

Implement it order-independently instead: a hop is a legal continuation exactly
when playing it still leaves the turn able to reach the maximum achievable
number of hops. Concretely, compute `L = maxPlayLength(turnStartBoard, dice)`,
replay `movesPlayed` validating each hop the same way, and then offer every hop
`m` with `1 + maxPlayLength(after m, remaining - m.die) === L - movesPlayed.length`.
The higher-die rule is applied only at `movesPlayed.length === 0` and only when
`L === 1` and the roll is not doubles. `src/engine/continuations.test.ts` pins
this down.

```ts
export function isSequenceComplete(
  board: BoardState, player: Player, dice: readonly DieValue[],
  movesPlayed: readonly Move[],
): boolean
```
True when `legalContinuations(...)` is empty.

---

## `src/engine/game.ts`

```ts
export function opponentOf(player: Player): Player

export function createGame(): GameState
```
`phase: 'opening-roll'`, `board: initialBoard()`, `cube: { value: 1, owner: null }`,
`turn: 'white'` (placeholder — the opening roll decides who actually starts),
`roll: null`, `dice: []`, `movesPlayed: []`, `turnStartBoard: null`,
`openingRolls: {}`, `cubeOfferedBy: null`, winner/winType/winReason all null.

```ts
export function applyOpeningRoll(state: GameState, player: Player, die: DieValue): GameState
```
Requires `phase === 'opening-roll'` and that `player` has not already rolled —
otherwise `IllegalMoveError`. Records the die. When both players have rolled:
- Equal dice: clear BOTH entries and stay in `'opening-roll'` (re-roll).
- Otherwise: the higher roller becomes `turn`, `phase` becomes `'moving'`,
  `roll` is `[higherDie, lowerDie]`, `dice = expandDice(roll)`,
  `turnStartBoard` is the current board, `movesPlayed = []`. `openingRolls` is
  kept for display. The opening roll can never be doubles, so the first turn is
  at most two hops.

```ts
export function applyRoll(state: GameState, roll: readonly [DieValue, DieValue]): GameState
```
Requires `phase === 'awaiting-roll'`. Sets `roll`, `dice = expandDice(roll)`,
`turnStartBoard = board`, `movesPlayed = []`, `phase = 'moving'`.
The engine NEVER generates dice — the server supplies them from a CSPRNG
(CLAUDE.md principle 1).

```ts
export function remainingDice(state: GameState): DieValue[]
```
`state.dice` is the FULL expanded roll and is not shortened as moves are played.
Remaining dice = `state.dice` minus the multiset `movesPlayed.map(m => m.die)`.

```ts
export function legalMovesNow(state: GameState): Move[]
```
`[]` unless `phase === 'moving'`. Otherwise
`legalContinuations(state.turnStartBoard!, state.turn, state.dice, state.movesPlayed)`.

```ts
export function canEndTurn(state: GameState): boolean
```
True when `phase === 'moving'` and `legalMovesNow(state).length === 0`.

```ts
export function applyMove(state: GameState, move: Move): GameState
```
Requires `phase === 'moving'` and that `move` matches (by `from`/`to`/`die`) one
of `legalMovesNow(state)` — otherwise `IllegalMoveError`. Applies the CANONICAL
move object from `legalMovesNow`, so `hit` is server-correct even if the client
sent it wrong. Appends to `movesPlayed`, updates `board`.
If the mover now has 15 checkers off, transition straight to `'game-over'` with
`winner = mover`, `winType = winTypeFor(board, mover)`, `winReason = 'bear-off'`.

```ts
export function undoLastMove(state: GameState): GameState
```
Requires `phase === 'moving'` and a non-empty `movesPlayed` — otherwise
`IllegalMoveError`. Replays `movesPlayed.slice(0, -1)` from `turnStartBoard`.

```ts
export function endTurn(state: GameState): GameState
```
Requires `phase === 'moving'` and `canEndTurn(state)` — otherwise
`IllegalMoveError`. Switches `turn` to the opponent, `phase = 'awaiting-roll'`,
clears `roll`, `dice`, `movesPlayed`, `turnStartBoard`.

```ts
export function resign(state: GameState, player: Player): GameState
```
Requires the game is not already over. Opponent wins, `winType: 'single'`,
`winReason: 'resign'`, `phase: 'game-over'`.

---

## `src/engine/cube.ts`

```ts
export function nextCubeValue(value: CubeValue): CubeValue
```
Doubles up to a maximum of 64; 64 stays 64.

```ts
export function canDouble(state: GameState, player: Player): boolean
```
True only when: `phase === 'awaiting-roll'`, `state.turn === player`, the cube is
centred or owned by `player`, and `state.cube.value < 64`. A player may never
double during `'opening-roll'` or mid-turn.

```ts
export function offerDouble(state: GameState, player: Player): GameState
```
Requires `canDouble(state, player)` — otherwise `IllegalMoveError`.
`phase = 'cube-offered'`, `cubeOfferedBy = player`, `turn = opponentOf(player)`
(the responder must act next). Cube value is NOT changed yet.

```ts
export function respondToDouble(state: GameState, player: Player, accept: boolean): GameState
```
Requires `phase === 'cube-offered'` and `player === state.turn` (the responder).
- **accept**: `cube = { value: nextCubeValue(cube.value), owner: player }`,
  `cubeOfferedBy = null`, `turn = <the offerer>`, `phase = 'awaiting-roll'`.
  The doubler still rolls and plays their turn.
- **decline (pass)**: the OFFERER wins at the CURRENT, un-doubled cube value.
  `phase = 'game-over'`, `winner = cubeOfferedBy`, `winType = 'single'`,
  `winReason = 'cube-pass'`.

```ts
export function winMultiplier(winType: WinType): 1 | 2 | 3
```
single 1, gammon 2, backgammon 3.

```ts
export function pointsWon(state: GameState): number
```
0 unless `phase === 'game-over'`. Otherwise `cube.value * winMultiplier(winType)`.
A declined double settles at the current cube value times 1.
