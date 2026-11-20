# City Chase — Notes

Findings, decisions, and doc-vs-reality disagreements. Source of truth for scope is `CITYCHASE_PLAN.md`.

## Phase 0 findings (2026-11-19)

### Auth
- `npx deepspace auth whoami` → logged in as Tanmay Gupta (developer account). The agent did not log in; the session already existed.
- CLI version: `deepspace v0.44.2`.

### Credits (answers open question "credit balance")
- `npx deepspace app usage` → **free plan, 374 of 500 credits remaining (100 credits = $1)**, so about $3.74 is left.
- Already spent in the last 30 days (by other apps): anthropic $0.79, exa $0.25, openai $0.17, openweathermap $0.05.
- Still open: whether DeepSpace gives applicants extra credits (Tanmay to ask).

### Scaffold
- `npx deepspace app create citychase` (starter template) → files in this folder, deps installed, `git init` done (branch `main`, **no commits yet**).
- The app is **not registered yet**. `npx deepspace app init --json` mints the app ID and makes the first commit. The agent has not run it: it registers the app to the account, so it needs Tanmay's OK.

### Integration endpoints (from `integrations list --json` + `integrations info`)
Full specs are saved in `docs/integrations/*.txt`.

| Plan job | Exact endpoint | Billing | Notes |
|---|---|---|---|
| OpenWeatherMap | `openweathermap/current` | $0.00195 / request | Input `{location \| q, units: metric}`. Output: `dt, temp, feels_like, humidity, pressure, visibility, description, icon, wind_speed, wind_deg, sunrise, sunset`. **No timezone field**, so the "21:40 local" HUD needs a static timezone per city (in the maze JSON). Night = `dt` outside `[sunrise, sunset]`. |
| Claude | `anthropic/chat-completion` | actual cost + markup | **The default model is `claude-opus-5-5` (expensive).** Always pass `model: "claude-haiku-5-5"` (the standard-priced one) and a small `max_tokens`. |
| Cerebras | **not available**: replaced by a second Haiku personality | — | See "Disagreements" below. |
| Resend | `email/send` | $0.013 / request | Sends from `DeepSpace Apps <notifications@updates.app.space>`. **`from` is ignored**; use `reply_to`. |

Weather cap check: 336 calls/day × $0.00195 ≈ $0.66/day at the cap. Emails at the cap: 30 × $0.013 = $0.39/day.

### Disagreements: plan vs reality
1. **Cerebras is not a DeepSpace integration.** Options for the "fast fallback / second personality" commander:
   - (a) `openai/chat-completion` with a small model (it exists, metered at actual cost);
   - (b) a second Claude personality on `claude-haiku-5-5` with a different system prompt;
   - (c) drop the second LLM: Claude → built-in default plan.
   **Decision (Tanmay, 2026-11-19): (b).** "The Strategist" and "The Swarm" are two system prompts on `anthropic/chat-completion` with `claude-haiku-5-5`. If one call fails or is invalid, try the other personality once, then use the built-in default plan.
2. **Email sender.** The plan says from `<app-name>@app.space`; reality is a fixed `notifications@updates.app.space` sender.
3. **Claude default model** is Opus. Cost rules require pinning Haiku in code.

## Open questions (status)
- Credit balance: answered above (374/500 free credits). Applicant credits: open.
- Endpoint names/limits: answered above. Rate limits are not shown in `info`; still open.
- Worker CPU limits for server replay: open (measure in Phase 3).
- Presence update rate for Live Chase: open (Phase 8).

## Phase 2: maze pipeline notes
- Street data comes from the public Overpass API (free, no key). It is called **only** by the offline script `npm run mazes:fetch`. The raw extracts are committed in `scripts/mazes/raw/`, so the builder is reproducible without the network. Data © OpenStreetMap contributors, ODbL; attribution is shown on the viewer and stored in each maze JSON.
- Road classes used: primary, secondary, tertiary, residential, unclassified, living_street, pedestrian (footways and service roads are excluded).
- Tuning knob: `MIN_SUPPORT` (default 0.5). It is the weighted metres of street, as a fraction of one 100 m cell, needed to open a corridor. At 0.0 every city became an almost full grid (about 150/304 links, looking alike). At 1.0 several cities fell apart. 0.5 gives 116–166 links and visibly different layouts.

## Phase 3 notes
- **Docs vs plan: Cerebras.** The AI chat guide (`docs.deep.space/guides/ai-chat.md`) lists "Claude, GPT, and Cerebras" for the `ai-chat` feature, but `integrations list` has no `cerebras` endpoint. So Cerebras seems to exist only inside the ai-chat provider routing, not as a server-action integration. Tanmay already chose Haiku × 2; this note is only for the writeup.
- **`dailies` collection dropped.** The daily city and seed are a pure function of the UTC date (`src/game/daily.ts`), so storing them would add a write path with nothing to protect. This is a deviation from the plan's data model §7 and needs Tanmay's OK.
- **Per-attempt salt (my addition).** Each run's seed is `dailySeed XOR salt`, where the salt is a random uint32 chosen by the server. City and maze are the same for everyone; ghost randomness differs per attempt. Without it, a public verified input log (needed for Ghost Races) could be resubmitted by anyone to copy the score.
- **Anti-cheat boundary.** Server-side replay proves the run is *legal*, not that a human played it. A bot that computes inputs in real time could still score well. The realtime check (`elapsed ≥ 0.9 × game time`) blocks offline search and fast-forwarding but not that. Documented as a known limit.
- `ActionTools.get(...).data.record.data` is typed `Record<string, unknown>`, so rows are cast through `unknown` in `src/actions/runs.ts`.
- `preview_start` with the launch.json config hung in "starting" with no logs. Running `npx deepspace dev start --port 5173` in a background shell works.
