# City Chase: writeup

**Live:** https://citychase.app.space · **Repo:** https://github.com/tanmayg15/citychase
Built for the DeepSpace internship build exercise. Coding agent: Claude Code. Human supervisor and decision-maker: Tanmay Gupta.

## What I built

A getaway-heist chase game where every level is a **real city district** (20 cities, street grids traced from OpenStreetMap) and **that city's live weather changes the rules**. You drive the getaway car, grab loot, reach the safehouse and avoid rule-based police who patrol, spot you down a street, radio your position and search for you.

- **Play instantly, no account.** Guests appear on the leaderboard as "Guest 1234". Signing in later moves their scores to the account.
- **Daily heist** (the same city and seed for everyone) and **Free Play** (any city × Live/Clear/Rain/Snow/Wind/Heat/Night/Fog).
- **Leaderboards:** All-time (one row per player), Daily, and one per city+weather, each showing the top 10 plus your own rank.
- **3D city** (Three.js, CC0 Kenney models) with a 2D fallback. A bot plays a live demo behind the lobby.
- **Gadgets:** nitro, oil slick (spins out a cop), disguise (cops lose you), plus crates on the map to refill them.
- **Race the #1 ghost:** an option to drive against the board leader's actual recorded run, replayed live as a translucent car.
- **Police radio:** 16 voiced lines (ElevenLabs) chosen by game events, with walkie-talkie filtering and subtitles.
- **#1 alerts:** opt-in email when someone takes your top spot.
- **Owner console** (`/ops`): kill switch, today's runs, and per-integration usage against caps.

## Main tradeoff: server-replay verification vs trusting client scores

The client never sends a score. It sends only the **input log** (which key on which tick). The server **re-runs the whole game** with the same engine and computes the score itself. The engine is fully deterministic: integer math, a seeded RNG, fixed 20 Hz ticks, and no `Math.random` or `Date.now`, so the browser and the Worker reach the same result bit for bit (pinned by a golden-hash test).

- **Gain:** cheat-proof scores. You can't post a fake number, speed-hack (a run must take at least 90% of its game time in real time) or replay a ticket (tickets are HMAC-signed and single-use).
- **Cost:** server CPU for each submit (production logs show replays at about 0 ms; Workers' timers are coarse, so read that as "too small to measure"). The engine also carries a hard constraint: any rule change must be versioned, or old runs stop verifying. That cost showed up for real when gadgets changed the rules (v2 → v3). I added `REPLAYABLE_VERSIONS` and proved with tests that v2 runs still play out identically, so older top runs can still race as ghosts.
- **Bonus:** because every verified run is reproducible, **ghost racing came almost for free.** The ghost is just a stored input log replayed next to you.

## Integrations (and why)

| Integration | Used for | Why it earns its place |
|---|---|---|
| **OpenWeatherMap** | Each city's current weather → game rules (rain = sliding, fog = shorter cop sight, night = darkness, wind pushes patrols, heat = longer smoke) | It's the core idea: the same map plays differently every day |
| **ElevenLabs** (text to speech) | Police radio voices | Atmosphere. Each line is generated **once ever** and cached, so the ongoing cost is ~0 |
| **NewsAPI** | A live headline ticker about today's city in the lobby | Makes the daily city feel current. Cached and refreshed at most hourly |
| **Email** (platform integration) | Opt-in "you lost #1" alerts | Retention, with caps per user and per day |

**Cost design (a hard requirement from me):** `INTEGRATIONS_MODE` (`live`/`mock`) **and** an owner kill switch must both allow a paid call. Every call reserves against daily caps first (global and per user). Guests never trigger paid calls (they get cached weather only). Each feature has a free fallback (mock weather, canned ticker, a radio crackle with subtitles). There's no paid cron.

**Left out on purpose:** payments (no real product to sell), maps at runtime (mazes are pre-built from OSM, so no map API bill), LiveKit/live multiplayer (time), and any ML/LLM. I decided to keep the cops rule-based and remove the planned LLM "commander".

## DeepSpace primitives used (instead of reimplemented)

- **RecordRoom collections + RBAC:** runs, scores, weather/news/radio caches, usage counters, prefs and settings. Clients can't write scores; only server actions can.
- **Server actions** (`startRun`, `submitRun`, `claimRun`, `claimGuest`, `getOpsStatus`, …) and public Hono routes for guest play and the ghost.
- **Integration proxy** for all four APIs (no API keys in the app).
- **DeepSpace auth** (Google/GitHub), `AuthGate` for protected pages, `uniqueOn` indexes (one row per player per board).
- **Secrets store** for `RUN_TICKET_SECRET` (set via `--stdin`, never in git).
- **`deepspace deploy`** with GitHub as the source of record, plus the platform's Playwright test runner.

## What the agent did

Claude Code wrote essentially all the code, tests and docs:
- the deterministic engine
- the OSM → maze pipeline
- the 3D/2D renderers
- server verification and guest tickets
- the integrations with their cost guard
- the leaderboards, lobby, gadgets, ghost racing and radio director
- the page design and the final cleanup

It kept `VERIFICATION_LOG.md` (what it did and what needs human checking, per phase) and `NOTES.md` (findings, and where the docs disagreed with reality). It debugged by measuring first. Examples:
- It traced slow 3D loading to 23 duplicate texture downloads.
- It traced a 500 on guest submit to a `uniqueOn` index that DeepSpace never drops.
- It traced a missing ghost to an engine-version mismatch.

It asked before every push, deploy, secret, schema change and paid-call switch.

## What I (Tanmay) verified or changed

- **Changed the game's direction:** after playtesting the first build I judged it "just Pac-Man" and redirected it to a police-and-thief heist.
- **Ruled out ML/RL/neural networks** and the LLM commander. The cops stay rule-based.
- **Product calls:** play without sign-in, a single lobby page, Free Play with any weather, the Kenney F1 car, a fixed start position with a respawn countdown, gadgets and the ghost-race option.
- **Found bugs by playing.** The agent fixed each one, and I re-checked it:
  - turns lagging a tile
  - a turn still taken after passing a junction
  - the car not rotating into turns
  - the car shaking on restart
  - scores showing on All-time but not on the city boards
  - truncated tabs
  - the leaderboard overlapping Free Play
  - the ghost missing on the Bengaluru night board
- **Approved every deploy and push**, set secrets myself and logged in myself (the agent never handled credentials). I set the cost rules and checked the owner console.
- **Tested the leaderboard** with ~15 bot-driven guest runs (top 10 plus "your rank" correct). The anti-cheat check also rejected runs submitted faster than real time, as intended.

## Testing

- **Unit:** 191 Vitest tests. They cover engine determinism and golden replay, version compatibility, the rules, gadgets, motion and junction timing, guest tickets (forgery, reuse, expiry), the leaderboard, cost caps and the kill switch, ghost lookup, the radio director, and the city maps.
- **Browser and API:** Playwright smoke and API suites against the real worker (lobby without sign-in, the `/home` sign-in landing, 404, auth gate, ghost endpoint validation, forged-ticket rejection, owner-only ops).
- **Static checks:** TypeScript (strict, no unused variables) and ESLint are clean. The production build passes.

## Unfinished, and what I'd do next

- **Live Chase** (real-time multiplayer with presence): planned, not built. The ghost race is the asynchronous version.
- **Radio using real street names**, plus pedestrians and floating street labels in 3D: descoped for time.
- **Endless mode** and challenge-a-friend emails: not built.
- **A two-account Playwright test of the ghost race and sign-in claim:** not automated. It was checked by hand with guest identities.
- **Ops and Settings while signed in** can only be checked by hand (the agent can't sign in): [TANMAY: confirm after checking].
