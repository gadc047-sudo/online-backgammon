# Online Backgammon

Realtime online multiplayer backgammon for two players in the browser, with the doubling cube,
gammon and backgammon multipliers, private tables behind a share code, virtual chips, and a
computer opponent for instant single-player games.

**PLAY MONEY ONLY.** The chips in this game are virtual counters with no value. There is no real
currency, no payments, no deposits, no purchases and no cash-out. See
[Not a gambling product](#not-a-gambling-product).

## Requirements

- Node.js 20 or newer.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts two processes concurrently:

- Client (Vite dev server): <http://localhost:5173> — open this one.
- Server (Express + Socket.IO): <http://localhost:3001>

Vite proxies `/socket.io` and `/api` from 5173 through to the server on 3001, so the browser only
ever needs the 5173 URL.

## Play vs Computer

Click **Play vs Computer** on the home screen (local: <http://localhost:5173> after `npm run dev`;
live: the deployed URL). This seats you against a computer opponent immediately — no share code,
no waiting for a second player, no separate "waiting for opponent" screen.

The computer plays through the exact same server-side room logic and engine validation as a human
opponent (see `src/server/ai/`): it rolls with the same CSPRNG dice, its moves are re-validated by
the engine like anyone else's, and it can offer, take, or pass the doubling cube. Its move choice is
a heuristic evaluation — pip count, blot exposure (shots), made points and primes, anchors, and
bear-off progress — not a neural net or rollout engine, so it plays a solid intermediate game rather
than a perfect one. It reacts a beat after you act (roughly half a second) so the game feels like
it's actually taking its turn, not just recomputing everything instantly.

## Verify two-browser play

This walkthrough proves the MVP end to end. It needs two browser windows.

> **Use a private/incognito window or a different browser for player two — not a second tab of the
> same profile.** The anonymous player id is stored in `localStorage`, which is shared across tabs of
> one profile. A second tab would present the same identity and reclaim the same seat instead of
> joining as an opponent.

1. **Window one — create a table.** Open <http://localhost:5173> and create a table. You should see a
   five-character room code, and the table waiting for a second player.
2. **Window two — join.** Open <http://localhost:5173> in an incognito window (or a different
   browser) and join with that code. The shareable link `http://localhost:5173/?code=ABCDE` (your own
   code in place of `ABCDE`) should carry the code through and take you straight in.
3. **Both windows now show two seated players.** Each side should see its own colour, both player
   names, and both chip balances.
4. **Roll for the opening move.** Each player rolls a single die. Both opening dice should appear in
   both windows. The higher roller moves first, and those two dice are the roll they play. If the two
   opening dice tie, both players should be asked to roll again.
5. **Tap a checker.** On the side to move, tapping one of your checkers should highlight every point
   it can legally reach with the dice still unplayed. Tapping a highlighted point moves it; dragging
   the checker onto that point should do exactly the same thing.
6. **Watch the Done button.** It should stay disabled while any legal move remains, and become
   enabled only once the turn is genuinely finished — that is, when no legal move is left. If both
   dice can be played, you should not be able to end the turn having played only one.
7. **Offer a double.** Before rolling, the player on turn offers a double. The opponent's window
   should show the offer with a take/pass choice. Take it. In **both** windows the cube value should
   go from 1 to 2 and the cube should show as owned by the player who took. From that point only the
   owner should be able to offer the next double.
8. **Hard-refresh one window** (Ctrl+F5 / Cmd+Shift+R) mid-game. That window should reconnect and
   come straight back into the live game with the same board, dice, cube and chips — not a fresh
   table and not the lobby. The other window should carry on undisturbed.
9. **Play a game out.** When one side bears off all fifteen checkers, both windows should show the
   same result — win type (single, gammon or backgammon), the cube value, the points, and the chips
   moved — and offer a rematch.

## Scripts

Every script defined in `package.json`:

| Script | What it does |
|---|---|
| `npm run dev` | Runs `dev:server` and `dev:client` together (client 5173, server 3001). |
| `npm run dev:server` | Server only, via `tsx watch`, reloading on change. |
| `npm run dev:client` | Vite dev server only. |
| `npm run clean` | Deletes `dist/`. |
| `npm run build` | `clean`, then `build:server`, then `build:client`. |
| `npm run build:server` | Compiles server, engine and shared types with `tsc` into `dist/`. |
| `npm run build:client` | Builds the client bundle with Vite into `dist/public/`. |
| `npm start` | Runs the built server: `node dist/server/index.js`. Serves the API, the sockets and the client. |
| `npm run typecheck` | Typechecks the client and server projects, emitting nothing. |
| `npm test` | Runs the test suite once with Vitest. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run lint` | ESLint over `src` for `.ts` and `.tsx`. |

Production build and run:

```bash
npm run build   # server -> dist/, client -> dist/public/
npm start       # one Node process serving both
```

## Architecture

```
src/
  engine/          pure rules engine - zero dependencies, no I/O, no RNG, no clock
    CONTRACT.md      the authoritative signature and semantics spec
    types.ts         core game types
    board.ts         board representation, geometry, pip count, win type
    moves.ts         legal move generation for a whole turn
    game.ts          turn state machine - roll, move, undo, end turn, resign
    cube.ts          doubling cube - offer, take, pass, scoring multipliers
    index.ts         barrel
  shared/          the wire contract between browser and server
    protocol.ts      snapshot shape, client and server event maps, constants
  server/          Express + Socket.IO, the only authority on game state
    ai/              computer opponent: board evaluation, move/cube choice, action scheduling
  client/          React 18 + Vite single-page app
```

**`src/engine` — the rules.** A pure, dependency-free TypeScript module: no I/O, no network, no
framework imports, deterministic given a state and dice, and every mutator returns a new state rather
than mutating its argument. It never generates dice itself. It generates *complete legal move
sequences for a turn* rather than validating one hop at a time, so the rules that only resolve at
turn level fall out of the generator: both dice must be played when a sequence exists that plays
both; the higher die must be played when only one can be; doubles give four hops; checkers on the bar
must re-enter before anything else; bearing off needs an exact roll, or a higher one only when no
checker sits further out. Because it imports nothing, it is exhaustively unit-testable in isolation,
and it is covered by unit tests — run them with `npm test`.

**`src/shared` — the wire contract.** One definition of the protocol, imported by both sides, so
client and server cannot drift. It may import engine *types*; the engine never imports it.

**`src/server` — the only authority.** The server owns these, and the client never decides them:

- **Dice.** Generated server-side with `crypto.randomInt`. Never `Math.random`. A client able to
  influence its own rolls would break the game outright, play money or not.
- **Move legality.** Every submitted move is re-validated against the engine server-side, whatever
  the client believed it had already checked. The server then applies its own canonical move object,
  so a client cannot mis-report a hit.
- **Cube state** — value, ownership, and who may offer.
- **Chip balances** and settlement.

Rooms live in memory on the server and survive a client disconnect. **Reconnection resyncs by sending
a full authoritative state snapshot, not an event replay** — `RoomSnapshot` in
`src/shared/protocol.ts` is sent whole on every change, never as a delta.

**`src/client` — render and request.** React 18 with Vite. It decides nothing. Every snapshot
carries a `legalMoves` array that the server computed *for that specific recipient*, so the
client's entire rules integration is filtering that array to decide which points to highlight.
It imports the engine only for shared types and three pure display helpers (`pointAt`,
`pipCount`, `nextCubeValue`) — it never calls a legality function, and there is no second
implementation of the rules to drift out of sync. When a snapshot arrives it replaces local
state wholesale rather than merging, so the server always wins on conflict.

## Decisions made for this MVP

| Decision | Choice | Why |
|---|---|---|
| Framework and topology | Vite SPA plus Express and Socket.IO in one long-lived Node process, not Next.js | WebSockets need a process that stays up. Serverless and edge runtimes cannot hold one. A single Node process keeps the realtime layer and the static client in one deployable. |
| Realtime transport | Socket.IO, not raw `ws` | Reconnection and transport fallback come with it. Mobile browsers drop sockets routinely — backgrounding a tab is enough — so reconnect handling is a requirement, not a nicety. |
| Repository shape | Single package, not a monorepo | Client and server ship as one service, so a workspace split buys nothing. |
| Room state | In memory | Right for v1 and cheap. It does not survive a redeploy: a restart drops every live game. Revisit before there are real users, not before. |
| Identity | Anonymous, id held in `localStorage` | No accounts, no signup, no password reset. Chips are per session. |
| Game format | Single games, not match play | Match play would pull in the Crawford rule and match-score special cases for the cube. Out of scope, so the Crawford rule does not apply. |
| Cube variants | None — no beaver, no raccoon | Extra cube rules, no MVP value. |
| Opponent | Human, or an instant-start computer seat | The computer is a normal seat (`isComputer` flag) driven through the same `RoomRegistry` methods a human uses, so there is no second rules or validation path. |

## Known limits

- Game state is in memory only. A server restart or redeploy drops every live game.
- Single instance only. There is no shared store, so the app cannot be scaled horizontally as it is.
- No persistence and no accounts. Chips reset when the process restarts.
- No spectators — a table seats exactly two players.
- No move clock and no timeout-to-forfeit.

## Deployment

GitHub to Railway, one service, auto-deploy on push.

- Builder: nixpacks.
- Build command: `npm run build`.
- Start command: `npm start`.
- `PORT` is injected by the platform and must be respected. The server reads `PORT` from the
  environment and falls back to `3001` locally. See `.env.example`.

`railway.json` in the repository root holds this configuration.

**It must run as a long-lived Node process.** Do not deploy this to a serverless or edge target.
Those runtimes cannot hold an open WebSocket, and the in-memory room registry assumes a single
process that stays alive between requests.

## Not a gambling product

The chips in this game are virtual counters used to score games. They have no value. They cannot be
bought, sold, transferred out of the app, exchanged, or redeemed for anything. There is no payment
integration, no deposit or withdrawal path, and no plan to add one.
