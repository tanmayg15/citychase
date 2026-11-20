import { beforeEach, describe, expect, it } from 'vitest'
import { Dir, MAX_TICKS, rngInt, type InputLog } from '../engine'
import { signTicket, verifyTicket } from '../server/tickets'
import { claimGuest, claimRun, guestStart, guestSubmit, startRun, MAX_GUEST_SUBMITS_PER_IP_PER_DAY, MAX_TICKET_AGE_MS } from './runs'
import { fakeTools, type Db } from './test-tools'

const env = { RUN_TICKET_SECRET: 'test-secret-0123456789abcdef', INTEGRATIONS_MODE: 'live' }
let db: Db
let paidCalls = 0
const tools = () => fakeTools(db, { integration: () => { paidCalls++; return {} } })

function log(seed = 5): InputLog {
  const out: InputLog = []
  let rng = seed
  for (let t = 0; t < 600; t += 6) { const [d, n] = rngInt(rng, 4); rng = n; out.push([t, (d + 1) as Dir]) }
  return out
}

/** Rewrite a ticket's start time (re-signed with the real secret) to simulate real elapsed time. */
async function aged(token: string, ms = MAX_TICKS * 50 + 1000): Promise<string> {
  const t = (await verifyTicket(env.RUN_TICKET_SECRET, token))!
  return signTicket(env.RUN_TICKET_SECRET, { ...t, startedAtMs: Date.now() - ms })
}

async function start(params: Record<string, unknown> = {}) {
  const r = await guestStart(env, tools(), params)
  if (!r.success) throw new Error(r.error)
  return r.data
}

const claim = (userId: string, ticket: string, inputLog: unknown) =>
  claimRun({ userId, params: { ticket, inputLog }, tools: tools(), env: env as never, callerJwt: 'x' })

beforeEach(() => { db = new Map(); paidCalls = 0 })

describe('guest play', () => {
  it('guest start makes no paid call and stores nothing', async () => {
    db.set('settings', new Map([['integrationsEnabled', { value: 'true' }]]))
    const g = await start()
    expect(g.ticket).toContain('.')
    expect(paidCalls).toBe(0)
    expect(db.get('runs')).toBeUndefined()
  })

  it('a claimed guest run is replayed and lands on the board under the signed-in user', async () => {
    const g = await start()
    const r = await claim('alice', await aged(g.ticket), log())
    expect(r.success).toBe(true)
    expect(db.get('scores')!.get(`${g.board}:alice`)).toBeTruthy()
  })

  it('a ticket can be claimed only once', async () => {
    const t = await aged((await start()).ticket)
    expect((await claim('alice', t, log())).success).toBe(true)
    expect(await claim('bob', t, log())).toEqual({ success: false, error: 'Run already submitted' })
  })

  it('rejects a tampered ticket (e.g. a changed seed or weather)', async () => {
    const t = await aged((await start()).ticket)
    const [body, sig] = t.split('.')
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    json.seed = 1
    const forged = btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sig
    expect(await claim('alice', forged, log())).toEqual({ success: false, error: 'Invalid ticket' })
  })

  it('rejects a ticket signed with another key', async () => {
    const t = (await verifyTicket(env.RUN_TICKET_SECRET, (await start()).ticket))!
    const other = await signTicket('not-the-secret', t)
    expect((await claim('alice', other, log())).success).toBe(false)
  })

  it('rejects an expired ticket and a too-fast claim', async () => {
    const g = await start()
    expect((await claim('alice', await aged(g.ticket, MAX_TICKET_AGE_MS + 1), log())).success).toBe(false)
    const fast = await claim('alice', g.ticket, log())
    expect(fast).toMatchObject({ success: false, error: 'Run rejected: finished faster than real time' })
  })
})

describe('free play setup', () => {
  it('uses the chosen city and weather preset and its own board', async () => {
    const g = await start({ mode: 'free', cityId: 'tokyo-shibuya', weather: 'snow' })
    expect(g).toMatchObject({ cityId: 'tokyo-shibuya', board: 'free:tokyo-shibuya:snow', mode: 'free' })
    expect(g.weather).toMatchObject({ condition: 'snow', source: 'preset' })
  })

  it('rejects an unknown city', async () => {
    const r = await guestStart(env, tools(), { mode: 'free', cityId: 'atlantis' })
    expect(r.success).toBe(false)
  })

  it('signed-in free play works too', async () => {
    const r = await startRun({ userId: 'alice', params: { mode: 'free', cityId: 'paris-marais', weather: 'night' }, tools: tools(), env: env as never, callerJwt: 'x' })
    expect(r.success && r.data).toMatchObject({ board: 'free:paris-marais:night' })
  })
})

describe('guest leaderboard', () => {
  async function guestRun(params: Record<string, unknown> = {}) {
    const g = await start(params)
    return { ...g, ticket: await aged(g.ticket) }
  }

  it('a guest run lands on the board under a generated guest name', async () => {
    const g = await guestRun()
    const r = await guestSubmit(env, tools(), { ticket: g.ticket, inputLog: log(), ...g.guest }, '1.2.3.4')
    expect(r.success).toBe(true)
    const row = db.get('scores')!.get(`${g.board}:guest_${g.guest.guestId}`)!
    expect(row).toMatchObject({ name: g.guest.guestName, guest: true })
    expect(g.guest.guestName).toMatch(/^Guest \d{4}$/)
  })

  it('reuses a genuine guest identity and rejects a forged one', async () => {
    const first = await start()
    const again = await start({ guestId: first.guest.guestId, guestToken: first.guest.guestToken })
    expect(again.guest.guestId).toBe(first.guest.guestId)
    const forged = await start({ guestId: first.guest.guestId, guestToken: 'f'.repeat(32) })
    expect(forged.guest.guestId).not.toBe(first.guest.guestId)
    const g = await guestRun()
    const r = await guestSubmit(env, tools(), { ticket: g.ticket, inputLog: log(), guestId: g.guest.guestId, guestToken: '0'.repeat(32) }, 'x')
    expect(r).toEqual({ success: false, error: 'Invalid guest identity' })
  })

  it('caps guest submissions per IP per day', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const g = await guestRun()
    // Pre-fill the counter for this IP to the cap.
    const { hashIp } = await import('../server/tickets')
    const key = `${date}:guest-submit:${await hashIp(env.RUN_TICKET_SECRET, '9.9.9.9')}`
    db.set('usage', new Map([[key, { count: MAX_GUEST_SUBMITS_PER_IP_PER_DAY }]]))
    const r = await guestSubmit(env, tools(), { ticket: g.ticket, inputLog: log(), ...g.guest }, '9.9.9.9')
    expect(r.success).toBe(false)
  })

  it('signing in moves guest scores to the account, keeping the best per board', async () => {
    const g = await guestRun()
    await guestSubmit(env, tools(), { ticket: g.ticket, inputLog: log(), ...g.guest }, 'ip')
    const guestRow = db.get('scores')!.get(`${g.board}:guest_${g.guest.guestId}`)!
    const r = await claimGuest({ userId: 'alice', params: { ...g.guest }, tools: tools(), env: env as never, callerJwt: 'x' })
    expect(r).toMatchObject({ success: true, data: { moved: 2 } }) // its board row + its all-time row
    expect(db.get('scores')!.get(`${g.board}:guest_${g.guest.guestId}`)).toBeUndefined()
    expect(db.get('scores')!.get(`${g.board}:alice`)).toMatchObject({ score: guestRow.score, userId: 'alice', guest: false })
    const run = db.get('runs')!.get(guestRow.runId as string)!
    expect(run.userId).toBe('alice')
  })

  it('claiming with a forged identity does nothing', async () => {
    const r = await claimGuest({ userId: 'mallory', params: { guestId: 'abc', guestToken: 'f'.repeat(32) }, tools: tools(), env: env as never, callerJwt: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('all-time board (one row per player)', () => {
  async function play(guest: { guestId: string; guestToken: string }, seed: number) {
    const g = await start({ ...guest })
    const t = await aged(g.ticket)
    const r = await guestSubmit(env, tools(), { ticket: t, inputLog: log(seed), ...g.guest }, 'ip')
    if (!r.success) throw new Error(r.error)
    return { g, score: (r.data as unknown as { score: number }).score }
  }

  it('keeps exactly one all-time row per guest, holding their best score', async () => {
    const first = await start()
    const id = { guestId: first.guest.guestId, guestToken: first.guest.guestToken }
    const scores = []
    for (const seed of [1, 2, 3, 4]) scores.push((await play(id, seed)).score)
    const rows = [...db.get('scores')!.entries()].filter(([k]) => k.startsWith('alltime:'))
    expect(rows).toHaveLength(1)
    expect(rows[0][1].score).toBe(Math.max(...scores))
  })

  it('on sign-in the all-time row becomes the account name with the better of the two scores', async () => {
    db.set('users', new Map([['alice', { name: 'Alice' }]]))
    const first = await start()
    const id = { guestId: first.guest.guestId, guestToken: first.guest.guestToken }
    const { score } = await play(id, 7)
    db.get('scores')!.set('alltime:alice', { board: 'alltime', userId: 'alice', name: 'Alice', score: score - 1 })
    await claimGuest({ userId: 'alice', params: { ...id }, tools: tools(), env: env as never, callerJwt: 'x' })
    const all = [...db.get('scores')!.entries()].filter(([k]) => k.startsWith('alltime:'))
    expect(all).toHaveLength(1)
    expect(all[0][1]).toMatchObject({ userId: 'alice', name: 'Alice', score, guest: false })
  })
})

describe('regression: same player, same day, several boards', () => {
  it('a run saves both its board row and the all-time row (old [date,userId] rule broke this)', async () => {
    const g = await start({ mode: 'free', cityId: 'nyc-midtown', weather: 'live' })
    const r = await guestSubmit(env, tools(), { ticket: await aged(g.ticket), inputLog: log(), ...g.guest }, 'ip')
    expect(r.success).toBe(true)
    const keys = [...db.get('scores')!.keys()]
    expect(keys).toContain(`free:nyc-midtown:live:guest_${g.guest.guestId}`)
    expect(keys).toContain(`alltime:guest_${g.guest.guestId}`)
    expect(db.get('scores')!.get(`alltime:guest_${g.guest.guestId}`)!.fromBoard).toBe('free:nyc-midtown:live')
    // A second board on the same day for the same player also works.
    const g2 = await start({ mode: 'free', cityId: 'paris-marais', weather: 'rain', guestId: g.guest.guestId, guestToken: g.guest.guestToken })
    const r2 = await guestSubmit(env, tools(), { ticket: await aged(g2.ticket), inputLog: log(2), ...g2.guest }, 'ip')
    expect(r2.success).toBe(true)
    expect([...db.get('scores')!.keys()]).toContain(`free:paris-marais:rain:guest_${g.guest.guestId}`)
  })

  it('the scores table only declares the [board, userId] rule', async () => {
    const { leaderboardSchema } = await import('../schemas/game-schemas')
    expect(leaderboardSchema.name).toBe('scores')
    expect(leaderboardSchema.uniqueOn).toEqual(['board', 'userId'])
  })
})

describe('ghost', () => {
  it('returns the best replayable run on a board, or null when there is none', async () => {
    const { getGhost } = await import('./runs')
    const g = await start({ mode: 'free', cityId: 'paris-marais', weather: 'clear' })
    expect((await getGhost(tools(), g.board)).data).toBeNull()
    await claim('alice', await aged(g.ticket), log())
    const r = await getGhost(tools(), g.board)
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ cityId: 'paris-marais', seed: g.seed })
    expect(r.data!.inputLog.length).toBeGreaterThan(0)
  })

  it('an older (v2) top run can still race as the ghost; an unknown version is skipped', async () => {
    const { getGhost } = await import('./runs')
    const g = await start({ mode: 'free', cityId: 'paris-marais', weather: 'clear' })
    await claim('alice', await aged(g.ticket), log())
    const runs = db.get('runs')!
    const [id, row] = [...runs.entries()][0] as [string, Record<string, unknown>]
    runs.set(id, { ...row, engineVersion: 2 })
    expect((await getGhost(tools(), g.board)).data).not.toBeNull()
    runs.set(id, { ...row, engineVersion: 1 })
    expect((await getGhost(tools(), g.board)).data).toBeNull()
  })

  it('rejects malformed board ids', async () => {
    const { getGhost } = await import('./runs')
    expect((await getGhost(tools(), 'alltime')).success).toBe(false)
    expect((await getGhost(tools(), { evil: 1 })).success).toBe(false)
  })
})
