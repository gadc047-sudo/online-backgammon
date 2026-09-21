# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: MVP implemented

The application exists and runs. Everything in the Commands and Repository layout sections
below is **verified** — the commands were executed and the paths were read from disk. Keep it
that way: if you change a script or move a directory, update this file in the same change.

## Product

Online multiplayer backgammon. Responsive web only — desktop and mobile browsers, no native apps.

- **Realtime 1v1** play between two connected clients.
- **Virtual-chip betting.** Play-money only. There is no real currency, no cash-out, no payment
  integration, and no path to one. Do not add anything that changes this without explicit approval —
  it moves the project into a regulated category.
- **Doubling cube**, with gammon (×2) and backgammon (×3) multipliers applied to the cube value.
- **Private rooms via share code.** Open matchmaking is not built.
- **Play vs Computer.** An instant-start table (no share code, no waiting screen) against a
  heuristic AI opponent — see principle 8 and `src/server/ai/`.
- **Jev vs Computer.** A spectator lane: TypeSafe's Jev plays the heuristic AI while the visitor
  watches without a seat. See principle 9 and `src/server/ai/jev/`.

## Stack

- **TypeScript throughout**, `strict` mode plus `noUncheckedIndexedAccess`. Types are shared
  between client and server rather than duplicated.
- **Vite + React 18** for the client, **Express + Socket.IO** for the server, in a **single
  long-lived Node process**. Not Next.js — see the decision table below.
- **Single npm package**, not a monorepo, because the client and server ship as one service.
- **Deployment** — GitHub → Railway auto-deploy (`railway.json`, nixpacks). Not yet provisioned.

## Architecture principles

These are the decisions that matter; they are cheap now and expensive later.

### 1. The server is the only authority on game state

Clients render and request; they never decide. Specifically the server owns:
- **Dice.** Generated server-side with a CSPRNG (`crypto.randomInt`, not `Math.random`) in
  `src/server/dice.ts`. Nothing else in the codebase may generate a die.
- **Move legality.** `RoomRegistry.move` calls the engine's `applyMove`, which re-derives the
  legal move set and substitutes its own canonical `Move` object — so a client cannot lie about
  a hit or claim a die it does not hold.
- **Cube state and chip balances.**

The client decides nothing. Every snapshot carries a server-computed `legalMoves` array for that
specific recipient, and the client's whole rules integration is filtering it. In practice the
client imports the engine only for shared types and three pure display helpers (`pointAt`,
`pipCount`, `nextCubeValue`) — it calls no legality function, so there is no second rules
implementation to drift. A snapshot replaces client state wholesale rather than merging, so the
server always wins on conflict.

### 2. The rules engine is a pure, standalone module

`src/engine/` is dependency-free TypeScript: no I/O, no network, no framework imports, no clock,
no RNG, deterministic given `(state, dice)`. Imported by both server and client. This is enforced
mechanically by a `no-restricted-imports` rule in `.eslintrc.cjs` scoped to `src/engine/**`.

`src/engine/CONTRACT.md` is the engine's specification and takes precedence over the
implementation. If they disagree, the contract is right and the code is a bug.

The engine **generates complete legal move sequences for a roll** rather than validating checker
hops one at a time, because several rules only resolve at the level of the whole turn:

- Both dice must be played if any legal sequence plays both.
- If only one die can be played, the **higher** one must be, where that is legal.
- Doubles yield four moves, not two.
- Checkers on the bar must re-enter before any other move is legal.
- Bearing off requires an exact roll, or a higher roll only when no checker sits on a higher point.

`GameState.turnStartBoard` exists for exactly this reason: legal sequences are always enumerated
from the board as it stood when the dice were rolled, never from the mid-turn board, or the
maximal-usage rules would silently break.

### 3. The turn is an explicit state machine

`GamePhase` is `opening-roll | awaiting-roll | moving | cube-offered | game-over`. A cube offer
interrupts turn flow, so `cube-offered` is a first-class phase, not a boolean. `GameState` carries
`winType` (single / gammon / backgammon) and `winReason` (bear-off / cube-pass / resign) for
settlement.

Cube ownership: centred, then owned by whoever last took. Only the owner may double.

### 4. Disconnection is normal, not exceptional

- Room state lives on the server and survives a client drop. A dropped socket calls
  `markDisconnected`, which keeps the seat and the game.
- Reconnect resyncs by sending a full authoritative `RoomSnapshot`, never an event replay.
- A returning `playerId` reclaims its own seat. Dropping never forfeits. There is no timeout-to-
  forfeit rule at all; add one only as a deliberate product decision with a generous window.

### 5. Know the limits of in-memory rooms

`RoomRegistry` is in-memory. It does not survive a redeploy and does not scale past one instance.
Both matter on Railway. Acceptable now; revisit (Redis or Postgres) before there are real users,
not before.

### 6. Deployment shape constrains the framework choice

Long-lived WebSocket connections need a long-lived Node process. This is why the project is a Vite
SPA served by an Express process rather than Next.js on a serverless target. **Never deploy this to
a serverless or edge runtime** — the realtime layer cannot survive there.

### 7. The board is the hard UI problem

- Fixed aspect ratio, scaling into both a phone portrait viewport and a wide desktop one.
- **Both** tap-to-move and drag-to-move — drag alone is painful on small touch targets.
- Point occupancy renders high checker stacks without overflowing the point.
- The board is drawn from the viewing player's seat, so each player sees their own checkers
  bearing off toward them.

### 8. The computer opponent is a seat, not a special case

- `Seat.isComputer` and a synthetic `computer:<code>` playerId are the only things that mark a
  seat as AI-controlled. Every action it takes — roll, move, offer/take/pass the cube, rematch —
  goes through the exact same `RoomRegistry` methods a human's socket handler calls, so there is
  no second, less-trusted code path to keep in sync with principle 1.
- `src/server/ai/driver.ts` is the only thing that decides *when* the computer acts. After every
  broadcast it asks `src/server/ai/nextAction.ts` "does the computer have something to do," and if
  so applies it after a short delay (`DEFAULT_COMPUTER_DELAY_MS`) so the game feels like someone is
  actually taking their turn. The delay and the scheduler are both injectable so tests never wait
  on a real timer.
- `src/server/ai/evaluate.ts` picks moves and cube decisions by a hand-weighted heuristic (race,
  blot risk via `shots.ts`, made points/primes, anchors, bear-off progress) — not a rollout or a
  neural net. It is intentionally simple enough to unit test board-by-board.
- The computer waits for the human to roll first during the opening roll. It could roll on its
  own the instant the table is created, but that races the human's own roll over the wire for no
  UX benefit.
- A table left with only a computer seat is torn down immediately (`leaveRoom`/`detach`), and the
  computer's seat never counts toward "is anyone still here" in `reap` — otherwise an abandoned
  vs-computer table would sit "waiting" forever, since the computer seat is always `connected`.

### 9. Jev is a seat that thinks out loud in structure, and a watcher is not a player

The third lane (`RoomMode` `jev-demo`) is principle 8 again with two twists.

- **Jev is `isJev` as well as `isComputer`.** Both seats at that table are driven, so the two
  drivers select on `isComputer && !isJev` and `isJev` respectively. Miss that filter and the
  heuristic driver plays Jev's seat out from under it.
- **Jev is white, always.** The client draws the board from the viewer's seat and falls back to
  white for anyone unseated, so white *is* the bottom seat for a spectator. That is the whole
  mechanism behind "Jev is always at the bottom" — there is no separate flip.
- **The spectator has no seat.** Not a disabled seat, no seat: `RoomRegistry.context()` rejects any
  caller without one, so "the watcher cannot move" is enforced by the same check that rejects a
  stray socket, not by a UI guard. They may do exactly one thing — restart the table once the game
  is over.
- **Decisions are structured, never prose.** `src/server/ai/jev/questions.ts` asks Choice questions
  whose criteria are fact tables computed by `describe.ts`. The model returns an option key, a
  probability distribution and a confidence; the label the panel shows was computed here before the
  question was sent. Nothing generated by a model is ever rendered. Do not add a "why" field.
- **The model cannot widen what is legal.** Options come from the engine's `legalSequences`. An
  answer naming a key that is not in the map is treated as a failed call, not as a move.
- **Every decision resolves.** Timeout, HTTP error, bad shape, unknown key or missing API key all
  fall back to the existing heuristic, marked `source: 'fallback'` with the error on the snapshot.
  A turn never waits on the API.
- **One decision per turn, one in flight per room.** `legalSequences` enumerates a whole turn, so
  the chosen play is cached and played hop by hop — a double costs one call, not four. A poke
  arriving while a call is out is dropped rather than queued.
- **No artificial delay.** Unlike the heuristic seat's 650ms, the Jev driver's default delay is 0.
  The only pause is the real call, surfaced as `jev.thinking`.
- **It stops when nobody is watching.** Two driven seats would otherwise play an unbounded series
  against a metered API for as long as a tab is open. The driver refuses to act without a connected
  spectator, and game-over is terminal — the watcher starts the next game.

## Commands

Verified against this repository. Node 20+ required (developed on Node 24).

| Command | What it does |
|---|---|
| `npm install` | Install dependencies. |
| `npm run dev` | Run client and server together. Client on http://localhost:5173, server on http://localhost:3001. Vite proxies `/socket.io` and `/api` to the server. |
| `npm run dev:server` | Server only, via `tsx watch`. |
| `npm run dev:client` | Vite dev server only. |
| `npm run build` | Clean `dist/`, compile the server to `dist/server/`, build the client to `dist/public/`. |
| `npm start` | Run the built server, which also serves the built client. Reads `PORT`, defaults to 3001. |
| `npm test` | Run the full vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npx vitest run src/engine` | Run only the rules-engine tests. |
| `npx vitest run -t "bears off"` | Run a single test by name substring. |
| `npm run typecheck` | Typecheck both the client/browser config and the server CommonJS config. |
| `npm run lint` | ESLint, including the rule that enforces engine purity. |
| `npx vitest run src/server/ai/jev src/server/typesafe` | Only the Jev lane's tests. |

Two tsconfigs is deliberate, not an accident: `tsconfig.json` typechecks everything for the
browser/bundler (ESNext modules, JSX, `noEmit`), while `tsconfig.server.json` is the one that
actually emits — CommonJS into `dist/`. `npm run typecheck` runs both because a change can pass
one and fail the other.

## Repository layout

```
src/
  engine/      Pure rules engine. Zero dependencies, no I/O, no RNG, no framework imports.
    CONTRACT.md    The engine specification. Authoritative over the implementation.
    types.ts       GameState, BoardState, Move, Player, GamePhase, CubeState.
    board.ts       Board construction, geometry, pip counts, applying a single hop.
    moves.ts       legalSequences() and friends. The hardest code in the project.
    game.ts        Turn state machine: rolls, moves, undo, end turn, resign.
    cube.ts        Doubling cube and settlement arithmetic.
    *.test.ts      Unit tests. Run with `npx vitest run src/engine`.
  shared/      Wire protocol types shared by client and server. May import engine TYPES only.
    protocol.ts    RoomSnapshot, Seat, ClientToServerEvents, ServerToClientEvents, chip constants.
  server/      Authoritative realtime server.
    index.ts       Express app, static hosting of dist/public, /api/health, createServer/startServer.
    socket.ts      Socket.IO event handlers and per-recipient snapshot fan-out.
    rooms.ts       RoomRegistry: rooms, seats, game orchestration, chip settlement.
    dice.ts        CSPRNG dice. The only source of randomness in the project.
    codes.ts       Share-code generation on an unambiguous alphabet.
    ai/            Computer opponent (principle 8): evaluate.ts (board scoring), shots.ts (hit-
                   chance counting), strategy.ts (move/cube choice), nextAction.ts (pure "what
                   should it do now"), driver.ts (schedules and applies it via RoomRegistry).
      jev/         Jev opponent (principle 9): describe.ts (candidate play -> fact table),
                   state.ts (position -> structured state), questions.ts (the three Choice
                   questions), policy.ts (enumerate, prefilter, ask, map back, fall back),
                   driver.ts (when Jev acts; one decision in flight per room).
    typesafe/      client.ts: TypeSafe System One HTTP client. The only place the API key is read.
    *.test.ts      Registry tests plus an end-to-end socket test that boots a real server.
  client/      React 18 SPA.
    main.tsx       Entry point mounted by index.html.
    App.tsx        Screen routing: home, waiting, game, game over.
    useSocket.ts   Socket.IO connection, snapshot state, action emitters.
    identity.ts    Anonymous playerId and name persisted in localStorage.
    boardLayout.ts Viewer-relative board geometry and stack-overlap maths.
    hooks/         useBoardInteraction (tap + drag; the only legalMoves consumer), useToasts.
    components/    Board, Point, Checker, Dice, CubeToken, CubeOfferModal, OffTray, BarZone,
                   HomeScreen, GameScreen, PlayerRail, GameLog, ResultBanner, ConnectionBadge.
```

Import direction is one-way and must stay that way: `engine` imports nothing local;
`shared` imports engine types; `server` and `client` import both. Nothing imports `client`.

## Decisions already made

Do not reopen these without a reason; they were settled deliberately.

| Decision | Choice | Why |
|---|---|---|
| Framework | Vite SPA + Express/Socket.IO in one Node process | WebSockets need a long-lived process; serverless cannot hold them. One service is the simplest thing that works. |
| Transport | Socket.IO | Built-in reconnection and transport fallback. Mobile browsers drop sockets when a tab is backgrounded. |
| Repo shape | Single package | Client and server deploy as one service, so workspaces buy nothing. |
| Persistence | In-memory only | Fine for v1. Revisit when there are real users. |
| Identity | Anonymous `playerId` in localStorage | No accounts, no auth surface. Chips are per-session and reset on restart. |
| Match play | Single games | No match score, so the Crawford rule does not apply. |
| Cube variants | None | No beaver, no raccoon. |
| AI opponent | Built: heuristic seat, no rollouts/neural net | Explicitly requested. A normal `RoomRegistry` seat (principle 8), not a parallel rules path. |
| Jev integration | Raw `fetch` against the HTTP API, not `@typesafe-ai/sdk` | The server emits CommonJS and Node 20+ has `fetch`. One less dependency, no ESM/CJS interop risk, and an injectable `fetchImpl` so no test touches the network. |
| Jev cube questions | Choice, not Noul | The panel's contract is choice + probabilities + confidence, and a Noul returns one probability with no confidence. One primitive means one render path and one fallback path. |
| Jev option cap | 24, heuristic-prefiltered above that | A loose double can generate hundreds of near-duplicate legal sequences. Past a couple of dozen the extra options cost tokens and latency without adding a real alternative. |
| Matchmaking | Not built | Private rooms by share code only. |

## Things that will bite you

- **Board geometry is asymmetric.** White moves 24→1 and bears off past 1; black moves 1→24 and
  bears off past 24. `distanceToOff` is the single place that asymmetry lives. Most engine bugs are
  a missing black-side case, so test both colours.
- **Narrowing does not survive into a closure.** `game.winner` narrowed to `Player` outside a
  callback is `Player | null` inside one. Hoist to a local first.
- **`noUncheckedIndexedAccess` is on.** `array[0]` is `T | undefined`. Handle it; do not paper over
  it with `!`.
- **The server compiles to CommonJS.** Use extensionless relative imports (`./board`, not
  `./board.js`) so both the bundler config and the tsc config resolve them.
- **Snapshots are per-recipient.** `legalMoves` is computed for one player. Never broadcast one
  shared snapshot object to a whole room.
- **`isComputer` is true for the Jev seat too.** Anything that means "the heuristic AI" must say
  `isComputer && !isJev`. `reap` and the room-teardown checks likewise count a *spectator* as
  someone being present, or a watched Jev table would be collected out from under its viewer.

## Never do

- Never add payments, real currency, cash-out, purchase, or transfer of chips out of the game.
  Chips are play money with no value. This is a hard product boundary, not a preference.
- Never generate dice anywhere except `src/server/dice.ts`, and never with `Math.random`.
- Never read `TYPESAFE_API_KEY` outside `src/server/typesafe/client.ts`, never log it, and never
  put it on a snapshot. It is server-side only.
- Never render model-generated text in the Jev lane. The panel shows a choice, probabilities and a
  confidence, and every label on it was computed from the board by this codebase.
- Never let `src/engine` import from `server`, `client`, `shared`, node builtins, or a framework.
- Never deploy to a serverless or edge target.
