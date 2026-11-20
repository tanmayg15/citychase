/**
 * Run lifecycle.
 *
 * Signed-in players:
 *   startRun  → server picks the city/seed/weather/plan, stores a 'started' run.
 *   submitRun → client sends ONLY {runId, inputLog}; the server replays the run
 *               with the engine and writes the score.
 * Guests (no sign-in needed to play):
 *   POST /api/guest/start → the same setup, returned as a server-SIGNED ticket
 *               (nothing stored, no paid calls).
 *   claimRun  → after signing in, {ticket, inputLog}; the server checks the
 *               signature, age, single use and real time, then replays it the same way.
 * Client-reported scores do not exist anywhere.
 */
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getCity } from '../cities'
import {
  DEFAULT_PLAN, ENGINE_VERSION, TICK_RATE, isReplayable, replay, seedFromString, validateInputLog,
  type CommanderPlan, type InputLog,
} from '../engine'
import { buildConfig, dailyFor, runSeed, utcDate } from '../shared/daily'
import { isPreset, presetWeather, type WeatherPreset, type WeatherRecord } from '../shared/weather'
import {
  hashIp, newGuest, newTicketId, signTicket, verifyGuest, verifyTicket, type GuestIdentity, type RunTicket,
} from '../server/tickets'
import { alertKnockedOff } from './media'
import { cachedWeather, resolveWeather } from './weather'

export const MAX_RUNS_PER_DAY = 40
/** One row per player: their best score ever, from any mode. */
export const ALL_TIME_BOARD = 'alltime'
/** Submitting must take at least this share of the game's real duration. */
const MIN_REALTIME_RATIO = 0.9
const MAX_RUN_AGE_MS = 15 * 60 * 1000
/** Guests may take a while to sign in after the run. */
export const MAX_TICKET_AGE_MS = 60 * 60 * 1000
const MAX_LOG_BYTES = 64 * 1024

export type RunMode = 'daily' | 'free'

interface RunRow {
  userId: string
  date: string
  mode: RunMode
  board: string
  cityId: string
  seed: number
  engineVersion: number
  weather: WeatherRecord
  plan: CommanderPlan
  startedAtMs: number
  status: 'started' | 'verified' | 'rejected'
  score?: number
}

interface LeaderRow { score: number }

export interface RunSetup {
  mode: RunMode
  board: string
  date: string
  cityId: string
  seed: number
  weather: WeatherRecord
  plan: CommanderPlan
}

function fail(error: string) {
  return { success: false as const, error }
}

function randomSalt(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const u = await tools.get('users', userId)
  if (!u.success) return 'Player'
  const data = u.data.record.data as { name?: string }
  return (data.name ?? 'Player').slice(0, 40)
}

/** Leaderboard id for a mode / city / weather choice. */
export function boardFor(mode: RunMode, date: string, cityId: string, preset: WeatherPreset): string {
  return mode === 'daily' ? `daily:${date}` : `free:${cityId}:${preset}`
}

/**
 * Pick everything a run needs. `userId` null = guest: never triggers a paid call.
 * Throws on bad params (callers turn that into an error result).
 */
export async function setupRun(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools, userId: string | null, params: Record<string, unknown>,
): Promise<RunSetup> {
  const date = utcDate()
  const mode: RunMode = params.mode === 'free' ? 'free' : 'daily'
  let cityId: string
  let preset: WeatherPreset = 'live'
  let baseSeed: number
  if (mode === 'daily') {
    const d = dailyFor(date)
    cityId = d.cityId
    baseSeed = d.dailySeed
  } else {
    if (typeof params.cityId !== 'string' || !getCity(params.cityId)) throw new Error('unknown city')
    cityId = params.cityId
    preset = isPreset(params.weather) ? params.weather : 'live'
    baseSeed = seedFromString(`free:${cityId}`)
  }
  const weather = preset !== 'live'
    ? presetWeather(cityId, preset, Date.now())
    : userId ? await resolveWeather(env, tools, cityId, userId) : await cachedWeather(tools, cityId)
  return {
    mode, date, cityId, weather,
    board: boardFor(mode, date, cityId, preset),
    seed: runSeed(baseSeed, randomSalt()),
    plan: DEFAULT_PLAN,
  }
}

/** Replay, run the real-time check, store the verified run, and update the board. */
type AlertEnv = Partial<Pick<Env, 'INTEGRATIONS_MODE' | 'APP_NAME'>>

async function verifyAndRecord(
  env: AlertEnv, tools: ActionTools, userId: string, runId: string, run: Omit<RunRow, 'status' | 'userId'>,
  inputLog: unknown, existing: boolean, nameOverride?: string,
): Promise<ActionResult<Record<string, unknown>>> {
  const reject = async (reason: string) => {
    if (existing) await tools.update('runs', runId, { status: 'rejected', rejectReason: reason })
    return fail(`Run rejected: ${reason}`)
  }
  if (run.engineVersion !== ENGINE_VERSION) return reject('engine version changed')
  if (JSON.stringify(inputLog ?? null).length > MAX_LOG_BYTES) return reject('input log too large')
  const check = validateInputLog(inputLog)
  if (!check.ok) return reject(check.error)

  const t0 = performance.now()
  const cfg = buildConfig({ cityId: run.cityId, seed: run.seed, weather: run.weather, plan: run.plan })
  const end = replay(cfg, inputLog as InputLog)
  const replayMs = performance.now() - t0

  const elapsedMs = Date.now() - run.startedAtMs
  const gameMs = (end.tick * 1000) / TICK_RATE
  if (elapsedMs < gameMs * MIN_REALTIME_RATIO) return reject('finished faster than real time')

  console.info(`[run] ${runId} board=${run.board} ticks=${end.tick} score=${end.score} replayMs=${replayMs.toFixed(2)}`)

  const result = { status: 'verified', inputLog, score: end.score, durationTicks: end.tick, outcome: end.status }
  const saved = existing
    ? await tools.update('runs', runId, result)
    : await tools.create('runs', { ...run, userId, ...result } as unknown as Record<string, unknown>, runId)
  if (!saved.success) return saved

  // Who is #1 on this board right now (for the "you lost #1" email alert)?
  const top = await tools.query('scores', { where: { board: run.board }, orderBy: 'score', orderDir: 'desc', limit: 1 })
  const leader = top.success ? (top.data.records[0]?.data as unknown as { userId: string; score: number } | undefined) : undefined

  // Best score per user per board.
  const lbId = `${run.board}:${userId}`
  const prev = await tools.get('scores', lbId)
  const prevScore = prev.success ? (prev.data.record.data as unknown as LeaderRow).score : -1
  if (end.score > prevScore) {
    const lb = await tools.create('scores', {
      board: run.board, date: run.date, cityId: run.cityId, userId,
      name: nameOverride ?? await displayName(tools, userId), score: end.score, runId, guest: userId.startsWith('guest_'),
    }, lbId)
    if (!lb.success) return lb
    if (leader && leader.userId !== userId && end.score > leader.score) {
      await alertKnockedOff(env, tools, {
        board: run.board, cityId: run.cityId, prevUserId: leader.userId, prevScore: leader.score,
        newName: nameOverride ?? await displayName(tools, userId), newScore: end.score,
        appUrl: `https://${env.APP_NAME ?? 'citychase'}.app.space/`,
      })
    }
  }
  // All-time board: exactly one row per player (guest or signed in), replaced only by a higher score.
  const atId = `${ALL_TIME_BOARD}:${userId}`
  const at = await tools.get('scores', atId)
  const atScore = at.success ? (at.data.record.data as unknown as LeaderRow).score : -1
  if (end.score > atScore) {
    await tools.create('scores', {
      board: ALL_TIME_BOARD, date: run.date, cityId: run.cityId, userId, fromBoard: run.board,
      name: nameOverride ?? await displayName(tools, userId), score: end.score, runId, guest: userId.startsWith('guest_'),
    }, atId)
  }

  return {
    success: true,
    data: {
      runId, board: run.board, score: end.score, outcome: end.status, durationTicks: end.tick,
      best: Math.max(end.score, prevScore), newBest: end.score > prevScore, replayMs,
    },
  }
}

export const startRun: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const date = utcDate()
  const today = await tools.query('runs', { where: { userId, date } })
  if (!today.success) return today
  if (today.data.count >= MAX_RUNS_PER_DAY) {
    return fail(`Daily limit reached (${MAX_RUNS_PER_DAY} runs). Come back tomorrow.`)
  }
  let setup: RunSetup
  try {
    setup = await setupRun(env, tools, userId, params)
  } catch (e) {
    return fail((e as Error).message)
  }
  const row: RunRow = { ...setup, userId, engineVersion: ENGINE_VERSION, startedAtMs: Date.now(), status: 'started' }
  const created = await tools.create('runs', row as unknown as Record<string, unknown>)
  if (!created.success) return created
  return { success: true, data: { runId: created.data.recordId, ...setup } }
}

export const submitRun: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const runId = params.runId
  if (typeof runId !== 'string' || runId.length > 100) return fail('runId required')
  const got = await tools.get('runs', runId)
  if (!got.success) return fail('Run not found')
  const run = got.data.record.data as unknown as RunRow
  // RBAC is off inside actions, so ownership is checked here explicitly.
  if (run.userId !== userId) return fail('Run not found')
  if (run.status !== 'started') return fail('Run already submitted')
  if (Date.now() - run.startedAtMs > MAX_RUN_AGE_MS) {
    await tools.update('runs', runId, { status: 'rejected', rejectReason: 'run expired' })
    return fail('Run rejected: run expired')
  }
  return verifyAndRecord(env, tools, userId, runId, { ...run, board: run.board ?? `daily:${run.date}` }, params.inputLog, true)
}

/** Guest start: the same setup as startRun, returned as a signed ticket. No auth, no storage, no paid calls. */
export async function guestStart(
  env: Pick<Env, 'INTEGRATIONS_MODE' | 'RUN_TICKET_SECRET'>, tools: ActionTools, params: Record<string, unknown>,
) {
  if (!env.RUN_TICKET_SECRET) return fail('Guest play is not configured')
  let setup: RunSetup
  try {
    setup = await setupRun(env, tools, null, params)
  } catch (e) {
    return fail((e as Error).message)
  }
  const ticket: RunTicket = { v: 1, id: newTicketId(), ...setup, engineVersion: ENGINE_VERSION, startedAtMs: Date.now() }
  // Reuse the guest's identity if it is genuine, otherwise issue a new one.
  const guest = (await verifyGuest(env.RUN_TICKET_SECRET, params.guestId, params.guestToken))
    ?? (await newGuest(env.RUN_TICKET_SECRET))
  return { success: true as const, data: { ticket: await signTicket(env.RUN_TICKET_SECRET, ticket), guest, ...setup } }
}

export const MAX_GUEST_SUBMITS_PER_IP_PER_DAY = 60

/**
 * Guest submit (no sign-in): verify the ticket + input log exactly like a
 * signed-in run and put the score on the board as "Guest 1234". Abuse
 * limits: the replay proves the score, tickets are single-use, names are
 * generated, and each IP (stored only as a keyed hash) gets a daily cap.
 */
export async function guestSubmit(
  env: Pick<Env, 'RUN_TICKET_SECRET'> & AlertEnv, tools: ActionTools, params: Record<string, unknown>, ip: string,
) {
  if (!env.RUN_TICKET_SECRET) return fail('Guest play is not configured')
  const guest = await verifyGuest(env.RUN_TICKET_SECRET, params.guestId, params.guestToken)
  if (!guest) return fail('Invalid guest identity')
  const t = await verifyTicket(env.RUN_TICKET_SECRET, params.ticket)
  if (!t) return fail('Invalid ticket')
  if (Date.now() - t.startedAtMs > MAX_TICKET_AGE_MS) return fail('Ticket expired')
  const runId = `t_${t.id}`
  if ((await tools.get('runs', runId)).success) return fail('Run already submitted')

  const date = utcDate()
  const ipKey = `${date}:guest-submit:${await hashIp(env.RUN_TICKET_SECRET, ip)}`
  const prev = await tools.get('usage', ipKey)
  const count = prev.success ? Number((prev.data.record.data as { count?: number }).count ?? 0) : 0
  if (count >= MAX_GUEST_SUBMITS_PER_IP_PER_DAY) return fail('Too many guest runs today: sign in to keep playing on the board')
  await tools.create('usage', { date, kind: 'guest-submit', scope: ipKey.split(':').pop()!, count: count + 1 }, ipKey)

  const { v: _v, id: _id, ...run } = t
  const res = await verifyAndRecord(env, tools, `guest_${guest.guestId}`, runId, run, params.inputLog, false, guest.guestName)
  return res.success ? { success: true as const, data: { ...res.data, guestName: guest.guestName } } : res
}

/** Signed-in: move a guest's runs and board entries to this account (keeps the best per board). */
export const claimGuest: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!env.RUN_TICKET_SECRET) return fail('Guest play is not configured')
  const guest: GuestIdentity | null = await verifyGuest(env.RUN_TICKET_SECRET, params.guestId, params.guestToken)
  if (!guest) return fail('Invalid guest identity')
  const guestUser = `guest_${guest.guestId}`
  const name = await displayName(tools, userId)
  const rows = await tools.query('scores', { where: { userId: guestUser }, limit: 500 })
  if (!rows.success) return rows
  let moved = 0
  for (const r of rows.data.records) {
    const g = r.data as unknown as LeaderRow & { board: string; date: string; cityId: string; runId: string }
    const mine = await tools.get('scores', `${g.board}:${userId}`)
    const myScore = mine.success ? (mine.data.record.data as unknown as LeaderRow).score : -1
    if (g.score > myScore) {
      await tools.create('scores', { ...g, userId, name, guest: false }, `${g.board}:${userId}`)
    }
    await tools.remove('scores', r.recordId)
    moved++
  }
  const runs = await tools.query('runs', { where: { userId: guestUser }, limit: 500 })
  if (runs.success) for (const r of runs.data.records) await tools.update('runs', r.recordId, { userId })
  return { success: true, data: { moved } }
}

/** Signed-in: turn a guest ticket + input log into a verified run, exactly once. */
export const claimRun: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!env.RUN_TICKET_SECRET) return fail('Guest play is not configured')
  const t = await verifyTicket(env.RUN_TICKET_SECRET, params.ticket)
  if (!t) return fail('Invalid ticket')
  if (Date.now() - t.startedAtMs > MAX_TICKET_AGE_MS) return fail('Ticket expired: play again to save a score')
  const runId = `t_${t.id}`
  const existing = await tools.get('runs', runId)
  if (existing.success) return fail('Run already submitted')
  const { v: _v, id: _id, ...run } = t
  return verifyAndRecord(env, tools, userId, runId, run, params.inputLog, false)
}

export interface GhostData {
  name: string
  score: number
  cityId: string
  seed: number
  weather: WeatherRecord
  plan: CommanderPlan
  inputLog: InputLog
}

/**
 * The best verified run on a board that still replays exactly (an engine
 * version isReplayable() accepts), for "race the ghost". Public: it exposes only a name, a score and
 * the key presses of a run that is already on the public leaderboard.
 */
export async function getGhost(tools: ActionTools, board: unknown): Promise<ActionResult<GhostData | null>> {
  if (typeof board !== 'string' || !/^(daily:\d{4}-\d{2}-\d{2}|free:[a-z0-9-]+:[a-z]+)$/.test(board)) return fail('bad board')
  const top = await tools.query('scores', { where: { board }, orderBy: 'score', orderDir: 'desc', limit: 50 })
  if (!top.success) return top
  for (const r of top.data.records) {
    const row = r.data as unknown as { runId: string; name: string; score: number }
    const run = await tools.get('runs', row.runId)
    if (!run.success) continue
    const d = run.data.record.data as unknown as RunRow & { inputLog?: InputLog }
    if (d.status !== 'verified' || !Array.isArray(d.inputLog) || !isReplayable(d.engineVersion, d.inputLog)) continue
    return {
      success: true,
      data: { name: row.name, score: row.score, cityId: d.cityId, seed: d.seed, weather: d.weather, plan: d.plan, inputLog: d.inputLog },
    }
  }
  return { success: true, data: null }
}
