/**
 * submitRun anti-cheat tests, run against an in-memory stand-in for the
 * ActionTools record API (same method shapes as deepspace/worker).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeTools, type Db, type Row } from './test-tools'
import { Dir, MAX_TICKS, replay, rngInt, type InputLog } from '../engine'
import { buildConfig } from '../game/daily'
import { MAX_RUNS_PER_DAY, startRun, submitRun } from './runs'

let db: Db

const ctx = (userId: string, params: Row = {}) =>
  ({ userId, params, tools: fakeTools(db), env: {} as never, callerJwt: 'x' })

interface Started { runId: string; cityId: string; seed: number }

async function start(userId = 'alice'): Promise<Started> {
  const r = await startRun(ctx(userId))
  if (!r.success) throw new Error(r.error)
  return r.data as Started
}

/** Pretend the player started long enough ago to have played in real time. */
function age(runId: string, ms = MAX_TICKS * 50 + 1000) {
  const row = db.get('runs')!.get(runId)!
  row.startedAtMs = Date.now() - ms
}

function log(seed = 5): InputLog {
  const out: InputLog = []
  let rng = seed
  for (let t = 0; t < 2400; t += 6) { const [d, n] = rngInt(rng, 4); rng = n; out.push([t, (d + 1) as Dir]) }
  return out
}

beforeEach(() => { db = new Map() })

describe('startRun', () => {
  it("creates a 'started' run for today's city with server-chosen seed", async () => {
    const s = await start()
    const row = db.get('runs')!.get(s.runId)!
    expect(row).toMatchObject({ userId: 'alice', status: 'started', cityId: s.cityId, seed: s.seed })
  })

  it('gives each attempt a different seed', async () => {
    const a = await start(), b = await start()
    expect(a.seed).not.toBe(b.seed)
  })

  it('caps runs per user per day', async () => {
    for (let i = 0; i < MAX_RUNS_PER_DAY; i++) await start()
    const r = await startRun(ctx('alice'))
    expect(r.success).toBe(false)
  })
})

describe('submitRun', () => {
  it('scores by server replay and ignores any client-sent score', async () => {
    const s = await start()
    age(s.runId)
    const r = await submitRun(ctx('alice', { runId: s.runId, inputLog: log(), score: 999_999 }))
    expect(r.success).toBe(true)
    const row = db.get('runs')!.get(s.runId)!
    const stored = row as { weather: never; plan: never }
    const expected = replay(buildConfig({ cityId: s.cityId, seed: s.seed, weather: stored.weather, plan: stored.plan }), log())
    expect(row.score).toBe(expected.score)
    expect(row.status).toBe('verified')
    expect(db.get('leaderboard')!.get(`${row.date}:alice`)).toMatchObject({ score: expected.score, runId: s.runId })
  })

  it('rejects a replayed request (same run submitted twice)', async () => {
    const s = await start(); age(s.runId)
    expect((await submitRun(ctx('alice', { runId: s.runId, inputLog: log() }))).success).toBe(true)
    const again = await submitRun(ctx('alice', { runId: s.runId, inputLog: log(9) }))
    expect(again).toEqual({ success: false, error: 'Run already submitted' })
  })

  it("rejects submitting someone else's run", async () => {
    const s = await start('alice'); age(s.runId)
    const r = await submitRun(ctx('mallory', { runId: s.runId, inputLog: log() }))
    expect(r.success).toBe(false)
    expect(db.get('runs')!.get(s.runId)!.status).toBe('started')
  })

  it('rejects a run finished faster than real time', async () => {
    const s = await start()
    const r = await submitRun(ctx('alice', { runId: s.runId, inputLog: log() }))
    expect(r).toMatchObject({ success: false, error: 'Run rejected: finished faster than real time' })
    expect(db.get('runs')!.get(s.runId)!.status).toBe('rejected')
  })

  it.each([
    ['malformed entries', [[0, 'up']]],
    ['out-of-order ticks', [[10, 1], [5, 2]]],
    ['huge log', Array.from({ length: 5000 }, (_, i) => [i, 1])],
    ['not an array', 'lol'],
  ])('rejects %s', async (_n, inputLog) => {
    const s = await start(); age(s.runId)
    const r = await submitRun(ctx('alice', { runId: s.runId, inputLog }))
    expect(r.success).toBe(false)
    expect(db.get('runs')!.get(s.runId)!.status).toBe('rejected')
  })

  it("copying another player's input log does not copy their score (per-run salt)", async () => {
    const a = await start('alice'); age(a.runId)
    await submitRun(ctx('alice', { runId: a.runId, inputLog: log() }))
    const b = await start('bob'); age(b.runId)
    await submitRun(ctx('bob', { runId: b.runId, inputLog: log() }))
    const runs = db.get('runs')!
    // Same maze and inputs, different ghost randomness: results differ.
    expect(runs.get(a.runId)!.seed).not.toBe(runs.get(b.runId)!.seed)
  })

  it('keeps only the best score on the leaderboard', async () => {
    const scores: number[] = []
    for (const seed of [1, 2, 3]) {
      const s = await start(); age(s.runId)
      const r = await submitRun(ctx('alice', { runId: s.runId, inputLog: log(seed) }))
      if (r.success) scores.push((r.data as { score: number }).score)
    }
    const lb = [...db.get('leaderboard')!.values()]
    expect(lb).toHaveLength(1)
    expect(lb[0].score).toBe(Math.max(...scores))
  })
})
