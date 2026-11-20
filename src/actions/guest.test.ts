import { beforeEach, describe, expect, it } from 'vitest'
import { Dir, MAX_TICKS, rngInt, type InputLog } from '../engine'
import { signTicket, verifyTicket } from '../server/tickets'
import { claimRun, guestStart, startRun, MAX_TICKET_AGE_MS } from './runs'
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
    expect(db.get('leaderboard')!.get(`${g.board}:alice`)).toBeTruthy()
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
