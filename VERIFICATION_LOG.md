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
