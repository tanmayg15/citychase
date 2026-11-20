# Verification Log

For each phase: what the agent did, what needs a human to check, and what Tanmay verified or changed (Tanmay fills in that last part).

## Phase 0 — Platform checks

### Agent did
- Checked auth with `npx deepspace auth whoami` (session already existed; the agent did not log in).
- Scaffolded the app with `npx deepspace app create citychase` (starter template). Git repo initialised, no commits.
- Copied `CITYCHASE_PLAN.md` into the app root.
- Ran `npx deepspace integrations list --json` and `integrations info` for the relevant endpoints. Recorded the exact names in NOTES.md and saved the specs to `docs/integrations/`.
- Checked the credit balance with `npx deepspace app usage`.
- Ran `npx deepspace app init --json` after Tanmay approved it. App ID: `app_01M7VAPR5HXV6D67W8VA85Z3JH` (in `wrangler.toml`). The CLI made the initial commit `575a916` (89 files) and set the local git identity from the DeepSpace login.
- Created the **private** GitHub repo https://github.com/tanmayg15/citychase with `gh` (Tanmay approved) and added it as `origin`. Nothing has been pushed.
- Pushed `main` to GitHub, then ran `npx deepspace deploy` (Tanmay approved). The site is live at https://citychase.app.space and returns HTTP 200. `app source` shows GitHub · tanmayg15/citychase as the source of record.

### Needs human verification
- Confirm the `whoami` account is the right one for the submission.
- Make the repo public, or give reviewers access, before submitting.
- Open https://citychase.app.space and check the starter page loads.

### Tanmay verified or changed
- Approved `app init`, the GitHub repo, the push and the first deploy.
- Decided: Cerebras is replaced by a second Claude Haiku personality.
- _(Tanmay to fill in more)_

## Phase 1 — Engine (no UI)

### Agent did
- Wrote `src/engine/`, a dependency-free TypeScript module that the browser and the worker will both import:
  - `types.ts`: plain JSON state, `Dir`/`Cell` enums, `CommanderPlan`, `WeatherModifiers`, `InputLog = [tick, dir][]`.
  - `rng.ts`: mulberry32 seeded RNG (integer only). `seedFromString` makes daily seeds.
  - `maze.ts`: text maze parser (`# . o P G`, with wrap-around tunnels).
  - `weather.ts`: pure `weatherToModifiers(snapshot)`. Rain/snow/drizzle/thunderstorm give 1 slip tile. Wind ≥ 8 m/s makes ghosts drift every 10 moves (≥ 14 m/s: every 6). Night gives 5-tile vision (render only). ≥ 28 °C makes power cores last 180 ticks instead of 120.
  - `plan.ts`: `validatePlan` strictly checks untrusted plans (4 ghost modes, ≤ 6 chokepoints on open tiles, taunt of 1–120 chars). `planOrDefault` falls back to `DEFAULT_PLAN`.
  - `engine.ts`: `createGame`, `step`, `replay`, `hashState`, `validateInputLog`. Runs at 20 ticks/s, capped at 3 min (3600 ticks). Player moves 1 tile per 4 ticks, ghosts 1 per 5, frightened ghosts 1 per 8. Ghost modes: chase, ambush (4 tiles ahead of the player), patrol (cycles through chokepoints), cutoff (nearest chokepoint to the player). There is a 5 s scatter-to-corners phase every 20 s. Input logs are capped at 4000 entries.
- 27 unit tests (`src/engine/engine.test.ts`): same inputs give the same hash; server replay equals live tick-by-tick play across 5 seeds; a different seed changes the result; one edited input changes the hash; the config maze isn't mutated; a **pinned golden replay hash**; walls, orb scoring, the time cap, power cores, rain momentum and wind drift; weather mapping; 7 malformed-log rejections; plan validation with 6 fallback cases.
- Measured a full 3600-tick replay at about **0.3 ms locally** (Node, without ghosts). The real CPU measurement on a deployed worker is still Phase 3.
- `tsc --noEmit` and `eslint src/engine` are clean.

### Design choices for Tanmay to review
- Tile-stepped movement (entities jump one whole tile every N ticks; the renderer will interpolate). This keeps everything integer and exact, at the cost of slightly less smooth control than sub-tile movement.
- The scatter phase is my own addition (not in the plan), so constant chasing doesn't feel unfair. Easy to remove.
- Night is render-only: the engine just exposes `visionRadius`.
- The golden hash test means **any rule change invalidates old replays**. That's intended: after launch, rule changes need an engine version field on runs.

### Needs human verification
- Run `npx vitest run src/engine` yourself and check you get 27 passing tests.
- Review the public API in `src/engine/index.ts` and the speed/score constants at the top of `src/engine/engine.ts`.
- Try breaking it: edit an entry in the golden test's log, or change a constant, and confirm the pinned hash fails.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Phase 2: City mazes (offline)

### Agent did
- `scripts/mazes/cities.mjs`: the 7 areas (centre lat/lon, IANA timezone). The timezone answers the "no timezone in the weather response" issue from Phase 0.
- `scripts/mazes/fetch-osm.mjs` (`npm run mazes:fetch`): downloaded street centrelines from Overpass into `scripts/mazes/raw/` (2.1 MB, committed). 7 requests in total, run once by hand.
- `scripts/mazes/build-mazes.mjs` (`npm run mazes:build`): projects to metres, **rotates each city to its dominant street bearing** (NYC 28.5°, Eixample 45.5°, …), traces streets onto a 15×11 node lattice (100 m spacing, giving a 31×23 tile grid), drops weakly supported links, keeps the largest connected piece, prunes all dead ends, then places ghosts at the junction nearest the centre, the player ≥ half the max path distance away near the bottom, 4 power cores near the corners, and orbs everywhere else. Output goes to `src/cities/data/*.json`, loaded by `src/cities/index.ts`.
- First attempt was too open (cities looked like near-identical full grids). Added road-class weighting plus the `MIN_SUPPORT` threshold, compared 0.5 / 0.6 / 1.0, and picked 0.5 (details in NOTES.md).
- Tests (`src/cities/cities.test.ts`, 28 new, 57 in total): for every city, all open tiles are reachable, there are 4 cores, more than 120 orbs and at least 3 ghost spawns, **no dead-end tiles**, and a full game runs deterministically. Valid IANA timezones.
- Debug viewer at **`/dev/mazes`** (static SVG page). Checked in the in-app browser: all 7 render and the console shows no errors.

### Known weaknesses (for Tanmay's judgment)
- Some mazes have big solid wall blocks where streets were dropped or disconnected (Tokyo lower-right, Mumbai right side, Paris centre). These show the real shape but waste screen space.
- No wrap-around tunnels on city maps (the engine supports them).
- The ghost "house" is just a junction, not an enclosed pen. Ghosts are released over time.

### Needs human verification (CP2: fun is judged by a human)
- Run `npm run dev` and open http://localhost:5173/dev/mazes. Look at every maze, then approve it or ask for a hand fix or a different `MIN_SUPPORT` or centre point.
- Optional: `MIN_SUPPORT=0.6 npm run mazes:build` to compare (it prints ASCII mazes). Revert with `npm run mazes:build`.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Phase 3: Solo Daily City and verified scores

### Agent did
- Read the DeepSpace docs before writing server code: server actions guide and reference, permissions, schemas, records, client auth.
- **Schemas** (`src/schemas/game-schemas.ts`):
  - `runs` uses `create/update/delete: false` for every role, so only server actions write. Read is `'published'` with `visibilityField status = verified`: verified runs are public (for Ghost Races), other runs are owner-only (`ownerField: userId`).
  - `leaderboard` is readable by everyone, server-write only, with `uniqueOn [date, userId]`.
- **Server actions** (`src/actions/runs.ts`):
  - `startRun`: the server picks today's city, mints a random per-attempt salt, stores a `started` run with weather and plan, and caps runs at 40 per user per day.
  - `submitRun`: the client sends only `{runId, inputLog}`. The server checks ownership, rejects a second submission, checks the engine version, validates the log (≤ 64 KB), **replays it with the stored seed/weather/plan**, rejects runs that finished faster than 0.9 × game time or are older than 15 min, then writes the verified score and upserts the best score per user per day. It logs `replayMs` for the CPU measurement.
- **Client**:
  - `src/game/renderer.ts`: neon canvas, with an original arrowhead "runner" and visor "drones", interpolated motion, and a night vision mask.
  - `src/game/GameCanvas.tsx`: fixed 20 Hz ticks on rAF, frame gaps clamped to 250 ms so the game slows instead of skipping, arrows/WASD/swipe, and an input log built through the same `step()` the server uses. Resizing does not restart the game.
  - `/home`: today's city, local time, leaderboard.
  - `/play` (sign-in required): start → 3 s countdown with taunt → play → verify → result, share string, leaderboard.
  - `/dev/play`: unverified practice with a city and weather picker.
  - Landing page copy and SEO updated.
- **Tests:** 13 new action tests against an in-memory `ActionTools` (72 in total, all passing): the server score ignores a client-sent `score`, a replayed request is rejected, another user's run is rejected, faster-than-real-time is rejected, 4 malformed-log cases are rejected, attempts get distinct seeds, the per-day cap holds, and the leaderboard keeps the best score only.
- **Checked in the in-app browser (local dev server):** the practice game runs (moving and eating orbs, ghosts released), night mode works, the console has no errors, `/home` loads the empty leaderboard for anonymous users, and `/play` shows the sign-in panel. `curl` against both actions with no token or a forged token returns **401**.

- After Tanmay approved: pushed to GitHub and deployed. On https://citychase.app.space, `/`, `/home`, `/play`, `/dev/mazes` and `/dev/play` return 200, `/home` loads with an empty leaderboard and no console errors, and an unauthenticated `submitRun` returns 401.

### Not verified by the agent
- **No signed-in end-to-end run.** That needs a real login (Tanmay) or a test account (needs Tanmay's OK to create).
- **Worker CPU time of the replay** is not measured yet; it needs the deployed build. It's logged as `[submitRun] … replayMs=` (watch with `npx deepspace logs --follow`).

### Needs human verification (CP3)
- After the deploy (needs approval), sign in on https://citychase.app.space, play a run, and check that the verified score and leaderboard update.
- **Try to cheat:**
  1. Call `/api/actions/submitRun` with a fake `score`.
  2. Edit the input log in DevTools before submitting.
  3. Resend the same submit request.
  4. Submit someone else's runId.
  5. Write to `runs`/`leaderboard` directly from the browser console.
- Approve or reject the deviations in NOTES.md: no `dailies` collection, the per-attempt salt.

### Tanmay verified or changed
- _(Tanmay to fill in)_
