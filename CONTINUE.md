# CONTINUE - ship SOTA online-backgammon MVP (resume)

You are Claude Code continuing (claude -c) after a prior run was killed at the 600s print-mode bg wait ceiling mid Workflow fan-out. Engine + shared protocol largely landed; server/client/README/build evidence did not finish. Finish the product. Do not restart from greenfield. Do not wait for the human.

## Current verified inventory (check before editing)

Already present:
- package.json — Vite SPA + Express/Socket.IO; scripts: dev, build, start, typecheck, test, lint
- src/engine/ — pure rules engine (types, board, moves, game, cube, tests, CONTRACT.md); CONTRACT + frozen exports are law
- src/shared/ — protocol types
- Empty shells: src/server/ empty; src/client/ only empty components/ and hooks/
- Missing: real server, real client UI, README.md, dist/, pass evidence for test/typecheck/build

Locked decisions (do not reopen): Vite SPA + Express/Socket.IO one Node process; Socket.IO; single package src/{engine,shared,server,client}; in-memory rooms v1; anonymous playerId in localStorage; single games; no beaver/raccoon; no AI; play-money chips only.

## Success criteria (all required)

1. Playable 1v1 MVP in two browser tabs: create room, share code, join, opening roll, move checkers, doubling cube offer/take/pass, bear-off/resign/cube-pass settlement with virtual chips.
2. Server is sole authority: CSPRNG dice via crypto.randomInt, re-validate every move with the engine, authoritative state plus full snapshot on reconnect. Clients never decide legality or rolls.
3. Client: responsive board (desktop + mobile), tap-to-move AND drag-to-move, legal-move highlighting, cube UI, room lobby, chip balances. SOTA polish, not a wireframe toy.
4. README.md with exact local run steps and architecture notes.
5. Evidence: run the package scripts for test, typecheck, and build — all must exit 0. Fix failures. Paste summaries in final report.
6. Update CLAUDE.md Commands + Layout to verified reality (replace pre-implementation fiction).

## Implementation mandate (SOTA quality)

### Server (src/server/)
- Express serves Vite dist/ in production; Socket.IO on same HTTP server.
- Rooms: create/join by short share code; 2 seats.
- Game loop: opening rolls -> awaiting-roll -> moving -> endTurn; cube-offered branch; game-over + chip settlement via pointsWon/cube/winType.
- Events mirror src/shared/protocol.ts; extend only if needed; keep types shared.
- Disconnection: keep room; reconnect sends full state snapshot.
- Play-money stakes only; document stake times pointsWon. No payments or cash-out.

### Client (src/client/)
- React 18 + Vite already configured (index.html, vite.config.ts).
- Beautiful readable board: fixed aspect ratio; phone portrait to wide desktop; stacked checkers; bar/off; dice; cube.
- Interactions: select-point then tap destination AND drag-drop; show legal targets (client may mirror engine for UX; server remains authority).
- Screens: Home (create/join + chips), Room waiting, Active game, Game over.
- Reconnect: restore playerId + room code from localStorage; resync snapshot.

### Tests and quality
- Keep/expand engine unit tests to match CONTRACT; add cheap server tests (room join, illegal move rejected, reconnect snapshot).
- eslint no-restricted-imports so engine cannot import server/client I/O.
- TypeScript strict everywhere.

### Do / Do not
- DO continue from existing engine/shared; fill server+client+README; verify with commands.
- DO use Workflow/agents if helpful, but finish even if you implement serially.
- DO NOT delete project files; do not add Next.js; do not add auth; do not add AI; do not add payments.
- DO NOT stop at scaffolding — leave a genuinely playable path.

## Verification checklist
Run test, typecheck, and build scripts until all exit 0. Smoke-start the app. Document gaps.

## Final report
Report pass/fail for test/typecheck/build; files added; local try path; blockers.
