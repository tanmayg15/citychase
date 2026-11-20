# City Chase — Build Plan (handoff for Claude Code)

> **Read this whole file before doing anything.** It is the source of truth for the project.
> Human supervisor: **Tanmay**. You (the coding agent) build; Tanmay directs, reviews, and approves.
> Deadline: **Tuesday, Nov 24, 2026, 11:59 PM ET** (DeepSpace internship build exercise).

---

## 0. Context

This is a DeepSpace take-home. Reviewers grade:
- a sensible scope, finished well; the deployed app works on its main path; unfinished edges explained honestly
- technical depth via working flows; integrations justified (target 3+)
- understandable code, **secrets protected**, **platform primitives used instead of reimplemented**
- a writeup: the main tradeoff, **what the agent did, and what Tanmay verified or changed**

**Human supervision is graded.** Follow Section 9 strictly.
**Cost rule:** Tanmay must not run up integration bills. Section 6 is mandatory, not optional.

Submit: live URL (`<name>.app.space`), GitHub repo, writeup.

---

## 1. The product

> **Redesign (2026-11-20, Tanmay):** after playtesting the first build, Tanmay judged it "just Pac-Man" and asked for a police-and-thief chase. The dot-eater rules below are replaced by the heist rules. Real-city streets, live weather, the AI commander, server-verified scores and all the platform/cost design are unchanged. Old wording is kept struck through for the record.

**City Chase** is a top-down heist chase where **each level is a real city's street grid**, and **that city's live weather changes the rules**.

- You drive the getaway car. Hit **loot drops** (about 10, placed on far-apart real junctions), then reach the **safehouse**, which opens after 5 loot.
- **Police cars** patrol. They spot you by **line of sight down a street** (headlight range), chase while they can see you, radio your last-seen spot to nearby units, then search it. Get caught 3 times and you're busted.
- **Smoke bombs** (4 per map) blind nearby cops for a few seconds.
- **Heat** rises every tick a cop can see you and costs points.
- Score = loot + (escape bonus + time bonus if you escape) − heat penalty.
- Controls: arrow keys / WASD / swipe.
- ~~Collect glowing orbs and dodge ghosts. Power cores let you hunt ghosts.~~
- **Original IP only:** own name, own sprites, top-down city-map look (buildings, roads, cars, light bars).

### Weather rules (live, from the city's current conditions)
| Condition | Effect |
|---|---|
| Rain / snow | Slippery: the car slides one extra tile when you turn |
| Strong wind | Crosswind pushes patrol cars in the wind direction |
| Night at the city | Smaller visible area around you **and** shorter cop headlight range |
| Heat | Smoke bombs last longer |
| Clear | Baseline |
The HUD shows the active conditions ("🌧️ Tokyo, light rain, 14°C, 21:40 local").

### AI Ghost Commander
Before each level, the AI gets a compact summary of the player's recent runs (where they turn, where they hesitate, average route) and returns a **structured strategy**: patrol mode per cop (guard loot / guard safehouse / patrol chokepoints / roam) + chokepoints + a one-line radio taunt. The response is checked against a schema; **if it's invalid or the call fails, use a built-in default strategy.** The game must never break because of the AI.

### Modes
- **Daily City (solo):** same city + seed for everyone each day; global leaderboard; share string `🏙️ Tokyo · 🌧️ · 48,200 · top 6%`.
- **Endless (solo):** cities back to back, with the difficulty rising.
- **Ghost Races (async multiplayer):** race translucent replays of friends' runs on the same map/seed.
- **Live Chase (real-time multiplayer):** one runner plus up to 3 friends controlling ghosts, in a room with a code. **This is the final phase**: built only after everything else is verified.

---

## 2. Technical pillars (where the depth comes from)

1. **Deterministic engine**: one shared TypeScript module (`src/engine/`) used by **both** the browser and the worker. Grid-based, fixed tick rate, integer math only, seeded RNG, no `Date.now()` or `Math.random()` inside the engine.
2. **Server-verified scores**: the client submits only `{seed, cityId, weatherSnapshotId, commanderPlanId, inputLog}`. A server action replays the run with the same engine and computes the score. Client-reported scores are ignored.
3. **Real city mazes**: an **offline** preprocessing script turns OpenStreetMap street data for 7 city areas into playable grid mazes (JSON committed to the repo). No map calls at runtime.
4. **Weather → gameplay**: a pure function `weatherToModifiers(snapshot)` that the engine consumes. The snapshot is stored with each run so replays stay deterministic.
5. **Adaptive AI**: a player-behaviour summary → a structured ghost plan (schema-checked, with a fallback).
6. **Replays as data**: the input logs power verification, ghost races and post-run replays.

---

## 3. Scope

Everything below is in scope. **Order matters**: riskiest foundations first, so there's always a working build.

1. Engine + tests (determinism)
2. City maze pipeline (offline) + 7 cities
3. Solo play (Daily City) with verified scores + leaderboard
4. Live weather rules
5. AI Ghost Commander
6. Ghost Races (async multiplayer) + challenge emails
7. Endless mode
8. Live Chase (real-time multiplayer)
9. Polish, tests, writeup

**Fallback rules (decided in advance, only if needed, with Tanmay's approval):**
- If OSM mazes aren't fun after tuning, hand-correct the generated mazes; keep the real-city outline.
- If Live Chase isn't stable by the final phase, ship it as "beta" or document it as next. Never let it break the core.

**Deferred (writeup only):** payments, native mobile.

---

## 4. DeepSpace integrations

Confirm exact endpoint names with `npx deepspace integrations list --json` / `info <endpoint>`. **Don't guess.**

| Integration | Job |
|---|---|
| **OpenWeatherMap** | Current weather for the level's city → gameplay modifiers |
| **Claude** | Ghost Commander plan + taunt |
| **Cerebras** | Fast fallback commander / second commander personality ("The Swarm" vs "The Strategist") |
| **Resend** (`email/send`, from `<app-name>@app.space`) | "X beat your Tokyo run, race their ghost" + room invites |

## 5. Platform primitives (don't reimplement)

| Primitive | Use |
|---|---|
| RecordRoom + permissions | runs, verified scores, leaderboards, ghost replays, rooms, usage counters, settings |
| Server actions | `submitRun` (replay + score), `getCommanderPlan`, `getWeather`, `challengeFriend`, room actions |
| PresenceRoom | who's playing today, Live Chase lobby, live positions in Live Chase |
| Platform auth | sign-in; required for anything that costs money |
| (Optional) R2 files | only if replay blobs get large |

---

## 6. Cost safety (mandatory)

1. **Mock mode** (`INTEGRATIONS_MODE=mock`) is the default during development: fixture weather + canned commander plans. Real calls only when Tanmay approves.
2. **Sign-in required** for every integration-backed action.
3. **Caching:** weather cached per city for 30 min in a records collection and shared by all players.
4. **Per-user caps:** commander 1 call per run, max 10 runs/day with AI; challenge emails 3/day.
5. **Global daily caps:** weather ≤ 7 cities × 48 = 336; commander ≤ 150; emails ≤ 30. When a cap is hit, use the fallback (default weather/plan). The game keeps working.
6. **Owner kill switch:** a `settings.integrationsEnabled` flag, writable only by the owner, checked in every integration action.
7. **Usage log:** count every real call by type/day, viewable by the owner, so Tanmay can see spend at a glance.
8. Never call integrations from cron/loops. **No scheduled jobs that cost money.**

---

## 7. Data model & permissions

| Collection | Contents | read | write |
|---|---|---|---|
| `cities` | id, name, mazeVersion (maze JSON ships in the bundle) | all | server |
| `dailies` | date, cityId, seed | all | server (deterministic from date, no cron) |
| `weatherCache` | cityId, snapshot, fetchedAt | all | server |
| `commanderPlans` | id, userId, plan JSON, model | own | server |
| `runs` | userId, cityId, seed, weatherSnapshot, planId, inputLog, verifiedScore, durationTicks | own; **public after verification for ghost races** | **server action only** |
| `leaderboards` | date/cityId, userId, score | all | server |
| `rooms`, `roomPlayers` | Live Chase rooms | members | server/host |
| `usage` | per-user + global counters by day | own (global: owner) | server |
| `settings` | integrationsEnabled, caps | owner | owner |

Rules: the client never writes a score. Runs are capped in length (e.g., 3 min of ticks). Replay CPU time is measured on a deployed build in Phase 3.

---

## 8. Build phases (each ends at a 🛑 checkpoint; wait for Tanmay's approval)

**Phase 0 — Platform checks**
Auth check (Tanmay logs in himself), scaffold, `integrations list` → record endpoints in NOTES.md, confirm GitHub as source of record, deploy hello-world from a GitHub-remote checkout.
🛑 **CP0:** findings + approval of first deploy.

**Phase 1 — Engine (no UI yet)**
Deterministic grid engine, weather modifiers, ghost AI behaviours driven by a plan object, seeded RNG. **Unit tests:** same inputs → identical state hash; replays of recorded logs; edge cases.
🛑 **CP1:** Tanmay reviews the engine API + runs the determinism tests himself.

**Phase 2 — City mazes (offline script)**
Node script: OSM extract for 7 areas (e.g., Manhattan Midtown, Tokyo Shibuya, Paris Le Marais, London Soho, Barcelona Eixample, Mumbai Fort, San Francisco Mission) → grid → prune dead ends / ensure connectivity → place orbs and power cores → JSON. A debug viewer page renders each maze.
🛑 **CP2:** Tanmay looks at every maze and approves or requests hand fixes. *(Fun is judged by a human.)*

**Phase 3 — Solo Daily City + verified scores**
Canvas renderer (neon style), input, HUD, Daily seed from date, `submitRun` server replay, leaderboard, share string. Measure server replay CPU time on a deployed build.
🛑 **CP3:** Tanmay plays on the live URL and **tries to cheat** (fake scores, edited input logs, replayed requests).

**Phase 4 — Live weather**
`getWeather` with caching, caps, kill switch, mock mode; HUD conditions.
🛑 **CP4:** Tanmay approves turning on real calls and checks the usage log.

**Phase 5 — AI Ghost Commander**
Behaviour summary → Claude plan (schema-checked) → Cerebras fallback → default plan. Taunt shown before the level.
🛑 **CP5:** Tanmay plays several runs and judges whether ghosts actually adapt; reviews prompts + fallbacks.

**Phase 6 — Ghost Races + challenge emails**
Load friends' verified runs as translucent ghosts; "challenge a friend" → Resend.
🛑 **CP6:** 2-account test.

**Phase 7 — Endless mode**
🛑 **CP7:** playtest.

**Phase 8 — Live Chase (real-time)**
Room code, presence lobby, runner + ghost players. Inputs are sent to the server-authoritative room state; clients predict locally and reconcile.
🛑 **CP8:** 2–3 browser test. Tanmay decides: ship, ship as beta, or document as next.

**Phase 9 — Hardening + submission**
Playwright: solo run flow + 2-account ghost race (`npx deepspace test accounts create`), error/empty states, mobile swipe, final deploy.
🛑 **CP9:** Tanmay approves the final deploy. Writeup drafted from VERIFICATION_LOG.md; Tanmay edits.

---

## 9. Supervision protocol (mandatory)

1. **Stop at every 🛑 checkpoint.** Summarize what changed, how to test it, what's open. Wait for explicit approval.
2. **Ask before:** any `deploy`, `secrets set`, `git push`, schema changes after CP1, adding integrations, switching mock → real calls, any `--yes` command, deleting anything.
3. Never ask for or handle passwords; Tanmay logs in himself.
4. No secrets in code or git.
5. Small commits, one concern each.
6. Don't guess APIs. Check docs.deep.space (MCP / `llms.txt` / `.md` pages) or `integrations info`. Log disagreements between docs and reality in NOTES.md.
7. **Maintain `VERIFICATION_LOG.md`** per phase: *Agent did* / *Needs human verification* / *Tanmay verified or changed* (Tanmay fills in the last one).
8. On failure: read the error → hypothesis → test → report. No blind retries.
9. Anything not covered here → ask Tanmay.

---

## 10. Open questions (answers go in NOTES.md)
- Credit balance / are there applicant credits? (Tanmay will ask the DeepSpace team)
- Exact OpenWeatherMap / Claude / Cerebras / Resend endpoint names and limits
- Worker CPU limits for server replay
- Presence update rate suitable for Live Chase

## 11. Writeup skeleton
- What I built + live URL
- Integrations + why; what I left out and why (payments, maps-at-runtime, LiveKit)
- Primitives used (permissions for verified scores, server actions, presence)
- **Main tradeoff:** server-replay verification (cheat-proof, costs server CPU, needs a deterministic engine) vs. trusting client scores
- Cost design (mock mode, caps, kill switch, no paid cron)
- What the agent did / what I verified / what I changed
- Unfinished + next


---

## 12. Phase 2 roadmap (agreed with Tanmay, 2026-11-20)

Phase 1 (engine, 7 city mazes, heist rules, 3D renderer, sound, verified scores, live weather, cost safety) is done and deployed. Tanmay's direction for the remaining days:

1. **Play without signing in.** Anyone can play. After a run: "Sign in to save to the leaderboard". Guest runs get a server-signed **run ticket** (HMAC, secret `RUN_TICKET_SECRET`). After sign-in the client submits `{ticket, inputLog}` (`claimRun`), and the server verifies the signature, freshness, single use and real time, then replays as before. Guests never trigger paid calls (cached or demo weather only). Sign-in is Google/GitHub (DeepSpace has no public email sign-up), worded "Continue with Google".
2. **One home page = the game lobby**, with a live 3D city (bot-driven attract mode) behind the menu. `/` and `/home` merge.
3. **Free Play:** pick any city (about 20 via the OSM pipeline) and any weather (Live, Clear, Rain, Snow, Wind, Heat, Night, Fog). Leaderboard per board (`daily:<date>`, `free:<city>:<weather>`).
4. **RL cop driving policy:** a Python port of the engine with **parity tests** against the TS engine (identical state hashes). PPO with a shared policy for 4 cops, trained against scripted getaway bots across all cities and weathers. Small MLP, **int8-quantized, integer-only inference in TS**, so server replay verification still holds. Evaluated against the rule-based cops (escape rate, time to catch).
5. **Cop radio chatter with audio:** event-driven lines using real OSM **street names** ("Unit 2, visual on suspect, northbound on Broadway"), including the policy's predicted turn ("he's turning right at 5th; Unit 3, block the north exit"). Browser speech synthesis (free), a different voice per unit, squelch and static, ducking. Text in a radio panel and speech bubbles over the cars.
6. **Living 3D world** (inspired by mantarjantar.in): pedestrians, trees and parks, varied rooftops, floating street names, an objective arrow with distance, a news ticker.
7. 2D is an automatic fallback only (no prominent switch).

**Moved to "documented as next":** Ghost Races, Endless, Live Chase multiplayer, the Claude commander (radio chatter + RL policy replace its role), challenge emails.
