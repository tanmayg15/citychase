/**
 * Run lifecycle server actions.
 *
 *   startRun  → server picks today's city, mints a per-attempt salt, stores a
 *               'started' run, returns everything the client needs to play.
 *   submitRun → client sends ONLY {runId, inputLog}. The server replays the
 *               run with the shared engine, using the seed/weather/plan it stored
 *               itself, and writes the score. Client-reported scores do not exist.
 *
 * Anti-cheat checks: owner match, single submission per run, engine version,
 * input-log validation, wall-clock time ≥ game time, per-user daily run cap.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, ENGINE_VERSION, TICK_RATE, replay, validateInputLog,
  type CommanderPlan, type InputLog, type WeatherSnapshot,
} from '../engine'
import { buildConfig, dailyFor, runSeed, utcDate } from '../game/daily'

export const MAX_RUNS_PER_DAY = 40
/** Submitting must take at least this share of the game's real duration. */
const MIN_REALTIME_RATIO = 0.9
const MAX_RUN_AGE_MS = 15 * 60 * 1000
const MAX_LOG_BYTES = 64 * 1024

interface RunRow {
  userId: string
  date: string
  mode: 'daily' | 'endless'
  cityId: string
  seed: number
  engineVersion: number
  weather: WeatherSnapshot
  plan: CommanderPlan
  startedAtMs: number
  status: 'started' | 'verified' | 'rejected'
  score?: number
}

interface LeaderRow { score: number }

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

export const startRun: ActionHandler<Env> = async ({ userId, tools }) => {
  const daily = dailyFor(utcDate())
  const today = await tools.query('runs', { where: { userId, date: daily.date } })
  if (!today.success) return today
  if (today.data.count >= MAX_RUNS_PER_DAY) {
    return fail(`Daily limit reached (${MAX_RUNS_PER_DAY} runs). Come back tomorrow.`)
  }

  // Phase 4 replaces these with the cached live weather and Phase 5 with the commander plan.
  const weather = CLEAR_WEATHER
  const plan = DEFAULT_PLAN
  const seed = runSeed(daily.dailySeed, randomSalt())
  const row: RunRow = {
    userId, date: daily.date, mode: 'daily', cityId: daily.cityId, seed,
    engineVersion: ENGINE_VERSION, weather, plan, startedAtMs: Date.now(), status: 'started',
  }
  const created = await tools.create('runs', row as unknown as Record<string, unknown>)
  if (!created.success) return created
  return {
    success: true,
    data: { runId: created.data.recordId, date: daily.date, cityId: daily.cityId, seed, weather, plan },
  }
}

export const submitRun: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const runId = params.runId
  const inputLog = params.inputLog
  if (typeof runId !== 'string' || runId.length > 100) return fail('runId required')

  const got = await tools.get('runs', runId)
  if (!got.success) return fail('Run not found')
  const run = (got.data.record.data as unknown as RunRow)
  // RBAC is off inside actions, so ownership is checked here explicitly.
  if (run.userId !== userId) return fail('Run not found')
  if (run.status !== 'started') return fail('Run already submitted')

  const reject = async (reason: string) => {
    await tools.update('runs', runId, { status: 'rejected', rejectReason: reason })
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
  if (elapsedMs > MAX_RUN_AGE_MS) return reject('run expired')
  if (elapsedMs < gameMs * MIN_REALTIME_RATIO) return reject('finished faster than real time')

  console.info(`[submitRun] run=${runId} ticks=${end.tick} score=${end.score} replayMs=${replayMs.toFixed(2)}`)

  const upd = await tools.update('runs', runId, {
    status: 'verified', inputLog, score: end.score, durationTicks: end.tick, outcome: end.status,
  })
  if (!upd.success) return upd

  // Keep the best score per user per day.
  const lbId = `${run.date}:${userId}`
  const prev = await tools.get('leaderboard', lbId)
  const prevScore = prev.success ? (prev.data.record.data as unknown as LeaderRow).score : -1
  let best = prevScore
  if (end.score > prevScore) {
    best = end.score
    const lb = await tools.create('leaderboard', {
      date: run.date, cityId: run.cityId, userId, name: await displayName(tools, userId),
      score: end.score, runId,
    }, lbId)
    if (!lb.success) return lb
  }

  return {
    success: true,
    data: { runId, score: end.score, outcome: end.status, durationTicks: end.tick, best, newBest: end.score > prevScore, replayMs },
  }
}
