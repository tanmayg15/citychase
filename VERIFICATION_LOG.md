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

## Phase 4: Live weather

### Agent did
- **Found and fixed a scaffold cost hole.** Any signed-in user could call any integration through `/api/integrations/*` on the owner's credits. Asked Tanmay mid-phase, then pushed and deployed only that fix (`08a180f`). Live check: 403.
- `src/game/weather-source.ts`: mock fixtures per city (night from the city's local time), `mapOwm` (icon code → condition, day/night from icon or sunrise/sunset), `OWM_QUERY` per city.
- `src/actions/guard.ts`: the single gate for every paid call. Checks mock vs live mode, the owner kill switch (default OFF) and per-user/global daily caps (weather 336/day, commander 150 + 10/user, email 30 + 3/user), and counts calls in the new `usage` collection.
- `src/actions/weather.ts`: `resolveWeather` tries a fresh live cache (30 min, shared via the public `weatherCache` collection), then a real call if permitted, then stale live data, then mock. `getWeather` action (sign-in required). `startRun` now freezes the resolved weather on the run, so the server replay uses exactly what the player saw.
- `src/actions/ops.ts` and `/ops` page: owner-only (`OWNER_USER_ID`, not just admin) status, kill switch toggle and today's usage against the caps.
- HUD: weather line ("🌧️ Tokyo, light rain, 14°C, 21:40 local") and rule badges (Slippery streets / Wind pushes drones → / Night: short sight / Heat: longer power / demo weather) on `/home` and in the pre-run countdown.
- Tests: 9 new (81 in total, all passing):
  - mock mode never calls the integration;
  - live mode with the switch OFF never calls it;
  - live and ON makes one call, then the cache is shared across users for 30 min;
  - a failing call falls back to stale data;
  - a bad response shape falls back to mock;
  - the global cap means no call;
  - the commander per-user cap is 10;
  - `mapOwm` cases;
  - only the owner can read ops status or flip the switch.
- Browser (local): `/home` and `/ops` (sign-in panel) load. Fixed a stale Vite cache that made app pages 404.

- Deployed Phase 4 in mock mode after Tanmay approved. Live: `/home`, `/ops` and `/play` return 200, `/home` renders with no console errors, and an unauthenticated `getOpsStatus` returns 401.

### Not verified by the agent
- **No real OpenWeatherMap call has been made yet.** Mock mode is the default and the kill switch defaults to OFF.
- The signed-in HUD and the owner console have only been checked through unit tests, not in a browser while signed in.

### Needs human verification (CP4)
1. Approve deploying Phase 4 (still mock).
2. Sign in, open `/ops`, and check: mode `mock`, switch OFF, usage all 0. Play a run and check the HUD shows demo weather and badges.
3. To go live, approve setting `INTEGRATIONS_MODE = "live"` in `wrangler.toml` `[vars]` and redeploying. Then **you** flip the switch ON in `/ops`, play once, and check `/ops` shows `weather 1` and `npx deepspace app usage` shows the cost (about $0.002 per call).
4. Flip the switch OFF and check the next run falls back (stale or demo weather) with no new usage.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Feedback round 1 (after CP4 mock playtest), 2026-11-20

### Tanmay's feedback (verbatim summary)
1. Movement is not smooth.
2. How are the enemies learning from behaviour (AI)?
3. "This looks just like Pac-Man." Wants something else, such as a police and thief chase. Chose the **Heist rework** option, not a reskin.

### Agent did
- **Smoothness.** Root cause: pieces move one tile every 4–6 ticks, but the renderer slid them across in **one** tick (50 ms) and then held them still, giving a hop-and-pause stutter. New `src/game/motion.ts` spreads each move over the piece's full move period at constant speed. The static map is cached in an offscreen canvas. Unit test proves constant per-frame movement. Browser: steady 120 fps (max frame 9.4 ms).
- **AI answer:** the commander (Phase 5) is not built yet. Cops follow a fixed default plan. Nothing learns yet. See the reply in chat and the Phase 5 plan.
- **Heist redesign** (plan §1 updated; engine version 1 → 2):
  - Engine: loot (10 per map, farthest-point sampling on junctions, worth more farther from the start), safehouse at the farthest junction (opens after 7 loot), smoke bombs on the old power-core tiles (blind cops within 7 tiles), 3 lives ("busted"), and score = loot + escape bonus + time bonus − heat/4.
  - Cops: patrol (commander modes are now `guardLoot` / `guardExit` / `patrol` / `roam`), **headlight vision** (straight ahead down the street, range 8 by day and 5 at night, plus adjacent tiles; you can sneak up behind), chase, a radio call sends nearby patrols to your last-seen spot, then they search it.
  - Weather: rain makes the car slide, wind pushes patrols, night shortens your sight *and* cop headlights, heat makes smoke last longer.
  - Renderer: top-down city map (roof colour per block, lane dashes, crosswalks), getaway car, police cars with flashing light bars, headlight beams (red when chasing), gem loot, smoke canisters, a safehouse with lock and pulse, and a dashed last-seen marker.
  - HUD: points, loot x/10, "Safehouse opens in N loot" or OPEN, a flashing WANTED, lives as cars, and time. New outcome text and landing/home copy.
- **Balance tool** `src/engine/balance.test.ts` (opt-in: `BALANCE=1`). A cop-blind bot that drives straight for loot escapes about half the time overall. NYC (20/20) and Mumbai (19/20) are easy; Paris (1/20) is hard.
- Tests: 86 passing. The golden replay hash was **re-pinned on purpose** (rules changed), and the tamper test now edits a stretch of driving (a single edit can be a no-op).

### Not verified / known gaps
- Not deployed. Not played by a human yet. Difficulty is per city and untuned for humans.
- Today's leaderboard may hold scores from the old game (engine v1). Unsubmitted v1 runs are rejected on submit ("engine version changed").

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Feedback round 2: "graphics one level above, as close to NFS/GTA as possible", 2026-11-20

### Decision
Tanmay chose **real 3D (Three.js)** over pseudo-3D or a polish-only pass, accepting that Live Chase (Phase 8) may become "documented as next".

### Agent did
- Added `three@0.170.0` (exact pin) and `@types/three`. The 3D renderer is a **lazy chunk** (`CityScene`, 137 KB gzip), loaded only when a game starts in 3D. Landing and home pages are unaffected.
- `src/game/three/CityScene.ts` (render-only; the engine and server replay are unchanged):
  - City built from the maze: buildings per 2x2 lot with varied heights, facades with procedural window textures (lit windows glow at night), gravel roofs, sidewalks inset from the road, asphalt with cracks, lane dashes, crosswalks, and street lamps with light pools at night.
  - Cars: low-poly original models (metallic-paint getaway car with racing stripes, a two-tone police cruiser), headlights and taillights, the player's spotlight headlight, and police light bars that flash red/blue and light the road while chasing or searching.
  - Props: spinning gold gems, smoke canisters, a safehouse garage with a green beacon and pulsing ring when open, red/yellow headlight beams on the road, and smoke puffs around blinded cops.
  - Atmosphere: sun with soft shadows, sky and fog by weather, a bloom pass, ACES tone mapping. Rain/snow particles and a **glossy wet road** in rain; mist fog; at night, dark sky, a car-centred vision circle (follows the car on screen) and dimmer lights.
  - Camera: a smooth 3/4 chase cam that keeps north up (so arrow keys match the screen) and is clamped inside the map.
- `GameCanvas`: one game loop, two views. 3D comes with a **2D minimap** overlay. The 2D view stays as a fallback: the 3D view falls back automatically if WebGL/scene creation or rendering fails, and is chosen by default only if WebGL2 and ≥ 4 cores are available. A "Graphics: 3D/2D" toggle is remembered per browser.
- **Bug found and fixed in testing:** switching from 2D to 3D reused the same `<canvas>` node, which already had a 2D context, so WebGL creation failed and it silently fell back. Fixed with distinct keys per view.
- Checked in the in-app browser: clear, night and rain all render. **Steady 120 fps** on this Mac (median 8.3 ms, max 9.3 ms per frame). No console errors. 86 tests pass; the production build succeeds.

### Not verified / known gaps
- Not deployed. Not tested on a phone or a low-end GPU (fallback logic exists but is untested on real weak hardware).
- Not NFS/GTA fidelity: no real road geometry from OSM (the grid maze stays), no vehicle physics, no destruction. It's a stylised, lit 3D city.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Feedback round 3: "bug: car stuck in the wall", "sound effects", "start, pause and end options", 2026-11-20

### Agent did
- **"Car stuck in the wall."** Checked the hypothesis before changing code: a throwaway test stepped every city in clear and rain/wind weather for **309,247 ticks** and asserted that no car is ever on a building tile. It passed, so the engine was fine and the bug was visual. Cause: the camera clamp pushed the car to the screen edge, where it was seen at a shallow angle behind tall blocks. Fix: the camera clamps much less near map edges, and cars hidden behind buildings show as **x-ray outlines** (orange for you, blue for cops), drawn only where occluded (reversed depth test).
- **Sound** (`src/game/sound.ts`): all generated with the Web Audio API, so no audio files or licences. Engine hum that rises when moving, a two-tone siren while any cop chases, a loot chime, a smoke whoosh, a "spotted" stinger, a crash when caught, a safehouse-open arpeggio, escape and busted jingles, and countdown beeps. Mute toggle remembered per browser. Audio starts only after a user gesture (browser rule) and is suspended while paused.
- **Start / pause / end:**
  - Practice shows a **Start** screen (button or Enter/Space).
  - **Pause** with the button or Esc/P. The pause menu has Resume / Restart / Quit; game time and the countdown freeze, wall time doesn't.
  - Practice shows an **end screen** (outcome, points, loot, Play again / Quit). The daily run keeps its existing verified-result screen and gains pause, Restart (starts a new run) and Quit.
- Checked in the browser: Start screen → Start → drive → P pauses (timer frozen at 177s over 3 s) → Esc resumes. No console errors. Tests pass.

### Not verified / known gaps
- I can't hear audio through the automated browser. **Tanmay needs to check the sounds by ear.**
- End screen not triggered in the browser test (same code path as the outcome state; covered by reading only).
- **Design note:** pausing gives thinking time in the daily mode. The server realtime check only needs elapsed ≥ 0.9 × game time, so pausing is allowed, but a run must still be submitted within 15 minutes of starting. Quitting a daily run leaves it unsubmitted, and it counts toward the 40/day cap.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Feedback round 4: "heat, wind and clear look the same", deploy on mock, 2026-11-20

### Agent did
- First attempt (light colour, fog, a low golden sun, debris) was **still hard to tell apart** in screenshots, because the top-down camera hardly sees the sky. Second attempt added a whole-picture **colour grade** per weather (ShaderPass): clear is vivid (saturation 1.22), heat is golden-warm with a subtle **heat-shimmer wobble**, wind is desaturated and cool with bigger multi-colour leaf/paper debris and brighter dust streaks. Checked side by side in the browser: now clearly distinct.
- After Tanmay asked: pushed and **deployed (mock mode)**. Live check: `/`, `/home`, `/play`, `/dev/play` return 200, and `/dev/play` runs in **3D** on the live site with no console errors.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Live mode switch, 2026-11-20

### Agent did
- Replaced the solid safehouse "garage" (it stood on a drivable road tile, so the car drove through it; Tanmay's screenshot) with a flat road pad: red hatching when locked, green beacon and ring when open. Checked in Paris, where the safehouse is visible from the start.
- **After Tanmay said "make it live":** set `INTEGRATIONS_MODE = "live"` in `wrangler.toml` `[vars]`, committed, pushed and deployed.
- Live checks after the deploy: all pages return 200; a direct browser call to `openweathermap/current` → **403**; `getWeather` without sign-in → **401**; `deepspace app usage` still shows **374/500 credits**, so nothing was spent by the switch itself.

### Needs Tanmay (CP4 live test)
1. Sign in and open `/ops`. It should show mode **live** and the kill switch **OFF** (the default).
2. Turn integrations **ON**, then play one daily run. The HUD should show real weather for today's city (no "demo weather" badge), and `/ops` should show weather 1.
3. Run `npx deepspace app usage`: openweathermap should be up by 1 call (about $0.002).
4. Optional: turn it OFF again and check the next run uses the last live weather (marked "last known weather") with no new calls.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Sound fixes, 2026-11-20 (Tanmay: "audio not playing on live", "sound plays when paused", "sounds for pickups and turning")

### Agent did
- **Silent on live:** audio was only unlocked by the practice Start screen. Daily runs have no in-game Start screen, and the game mounts after the async `startRun` request, which browsers don't treat as a user gesture. Fix: one shared audio engine (`getSfx()`), resumed **inside the Start run click**, plus a resume-on-next-gesture safety net.
- **Sound while paused:** my first pause suspended the AudioContext, but the new safety net woke it on the next key press. Fix: pause is now a state inside the sound engine. Engine and siren are silenced and one-off sounds dropped until resume. The start and end screens are silent too.
- **New sounds:** a tyre screech on every turn (longer and lower on wet roads) and a richer "cha-ching" for loot (smoke, spotted, caught, safehouse and the jingles already existed).
- **Measured in the browser** by wrapping `AudioContext`: one context, `running`. While driving the engine gain was 0.16. **While paused (with arrow keys pressed): engine 0, siren 0, 0 new sounds.** After resuming the engine came back. Three turns produced three new sound sources (screeches).

### Needs human verification
- Listen on the live site: volume balance, and whether the screech or siren gets annoying.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Phase 2, Day 1: guest play, lobby, Free Play, 20 cities (2026-11-20)

### Agent did
- **Plan:** §12 Phase 2 roadmap added to `CITYCHASE_PLAN.md` (agreed with Tanmay).
- **Secret** `RUN_TICKET_SECRET`: generated with `openssl rand` and piped via `--stdin` (never printed). A separate dev value is in the git-ignored `.dev.vars`.
- **Guest play:** public `POST /api/guest/start` returns a **server-signed run ticket** (HMAC-SHA256). It makes no paid calls and stores nothing. `claimRun` (sign-in required) checks the signature, age (≤ 1 h), **single use** and real time, then replays and records exactly like a signed-in run. The finished guest run waits in localStorage across the OAuth redirect; the lobby shows a "Save it" banner.
- **Free Play:** any city × 8 weather presets. Leaderboards per board (`daily:<date>`, `free:<city>:<weather>`). Schema: a `board` column and `uniqueOn [board, userId]`.
- **Lobby at `/`:** a bot-played 3D city in cinematic orbit behind the menu, Today's heist, the city grid + weather chips, leaderboards, sign-in, and a news ticker. `/home` redirects to it. A static `/about` page is prerendered. No nav bar on `/` and `/play`.
- **20 cities:** 13 added. Overpass backoff added (429/502/503/504). A per-city `minSupport` was added for 4 sparse cities. Weather queries and demo weather exist for all cities.
- **Tests:** 148 pass (9 new guest/free-play action tests and checks for all 20 cities). Playwright specs were updated (not run here).
- **Browser (local):** the lobby shows the live 3D background; a guest Free Play run (Paris, rain) ran with no sign-in, ended, and showed the score + "Continue with Google or GitHub", which reached Google's real sign-in page (the agent did not sign in). The waiting-run banner shows on the lobby.
- **Bugs found:** the lobby's 3D background was hidden behind the layout's opaque background (fixed with `isolate`). Stale browser module cache in dev after moving pages.

### Notes
- With 20 cities the daily rotation changed today's city (Mumbai → Singapore) mid-day.

### Needs human verification
- Sign in for real on the live site after a guest run and check the run is saved and appears on the board.

### Tanmay verified or changed
- _(Tanmay to fill in)_

## Scope change: no ML; project cleanup (2026-11-20)

### Tanmay's decision
"Do not add anything RL / NN related; keep it away from ML. Remove any changes or files for that, and any unnecessary files."

### Agent did
- Deleted the scheduled overnight RL training task and its prompt file. Deleted the `ml/` folder (Python 3.12 venv with PyTorch/NumPy; it was never committed). Removed the `ml/` lines from `.gitignore`.
- Removed the RL item from plan §12 (radio chatter stays, now explicitly rule-based) and added the decision to the plan. Removed "cops that learn" / "learns from every chase" / "cops that adapt" wording from the lobby and SEO, and an RL mention in `src/game/bot.ts`.
- **Removed unused scaffold files:** the AI chat agent (`src/ai/`, its `registerAgent` wiring in `worker.ts` and `<AgentTools />` in the app layout), `src/products.ts`, `src/subscriptions.ts`, the `/api-status` debug page, integration notes for Anthropic/OpenAI/email (unused), the Anthropic/email entries in `src/integrations.ts`, `pnpm-workspace.yaml` and `.yarnrc.yml` (the project uses npm), and the scaffold's `tests/collab.spec.ts`. Updated `AGENTS.md`.
- **Kept on purpose:** `src/cron.ts` and `src/jobs.ts` (empty), because their Durable Object classes (`AppCronRoom`, `AppJobRoom`) are registered in `wrangler.toml` migrations of the deployed app. Removing them would need a `deleted_classes` migration on the live app. Also kept the `/dev/mazes` and `/dev/play` debug pages and the opt-in balance test (all useful for development).
- Checks: `tsc`, `eslint`, 148 tests and the production build pass; the local server serves `/`, `/play`, `/about`, `/ops` and guest start.

### Tanmay verified or changed
- _(Tanmay to fill in)_
