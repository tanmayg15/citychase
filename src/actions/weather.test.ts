import { beforeEach, describe, expect, it } from 'vitest'
import { utcDate } from '../game/daily'
import { mapOwm } from '../game/weather-source'
import { CAPS, KILL_SWITCH_KEY, reserveCall } from './guard'
import { getOpsStatus, setIntegrationsEnabled } from './ops'
import { fakeTools, type Db } from './test-tools'
import { resolveWeather, WEATHER_TTL_MS } from './weather'

const LIVE = { INTEGRATIONS_MODE: 'live' }
const MOCK = {}
const OWM = { dt: 1_800_000_000, temp: 14.4, description: 'light rain', icon: '10n', wind_speed: 9.6, wind_deg: 200, sunrise: 1, sunset: 2 }

let db: Db
let calls: number
const tools = () => fakeTools(db, { integration: () => { calls++; return OWM } })
const enable = () => db.set('settings', new Map([[KILL_SWITCH_KEY, { key: KILL_SWITCH_KEY, value: 'true' }]]))

beforeEach(() => { db = new Map(); calls = 0 })

describe('resolveWeather', () => {
  it('mock mode never calls the integration, even with the switch ON', async () => {
    enable()
    const w = await resolveWeather(MOCK, tools(), 'tokyo-shibuya', 'u1')
    expect(w.source).toBe('mock')
    expect(w.condition).toBe('rain')
    expect(calls).toBe(0)
  })

  it('live mode with the kill switch OFF (default) uses mock', async () => {
    const w = await resolveWeather(LIVE, tools(), 'tokyo-shibuya', 'u1')
    expect(w.source).toBe('mock')
    expect(calls).toBe(0)
  })

  it('live + ON: one real call, then served from the 30-min cache for everyone', async () => {
    enable()
    const t0 = 1_800_000_000_000
    const a = await resolveWeather(LIVE, tools(), 'tokyo-shibuya', 'u1', t0)
    const b = await resolveWeather(LIVE, tools(), 'tokyo-shibuya', 'u2', t0 + WEATHER_TTL_MS - 1)
    expect(a).toMatchObject({ source: 'live', condition: 'rain', tempC: 14, windSpeed: 10, windDeg: 200, isNight: true })
    expect(b).toEqual(a)
    expect(calls).toBe(1)
    await resolveWeather(LIVE, tools(), 'tokyo-shibuya', 'u1', t0 + WEATHER_TTL_MS)
    expect(calls).toBe(2)
    expect(db.get("usage")!.get(`${utcDate(new Date(t0))}:weather:global`)!.count).toBe(2)
  })

  it('a failing call falls back to the last live weather, marked stale', async () => {
    enable()
    const t0 = 1_800_000_000_000
    await resolveWeather(LIVE, tools(), 'paris-marais', 'u1', t0)
    const broken = fakeTools(db, { integration: () => { throw new Error('upstream down') } })
    const w = await resolveWeather(LIVE, broken, 'paris-marais', 'u1', t0 + WEATHER_TTL_MS + 1)
    expect(w.source).toBe('stale')
    expect(w.tempC).toBe(14)
  })

  it('a bad response shape falls back to mock', async () => {
    enable()
    const odd = fakeTools(db, { integration: () => ({ hello: 'world' }) })
    expect((await resolveWeather(LIVE, odd, 'london-soho', 'u1')).source).toBe('mock')
  })

  it('the global cap stops real calls and the game still gets weather', async () => {
    enable()
    const date = utcDate()
    db.set('usage', new Map([[`${date}:weather:global`, { date, kind: 'weather', scope: 'global', count: CAPS.weather.global }]]))
    const w = await resolveWeather(LIVE, tools(), 'mumbai-fort', 'u1')
    expect(w.source).toBe('mock')
    expect(calls).toBe(0)
  })
})

describe('reserveCall per-user caps', () => {
  it('commander: 10 per user per day, global still counts', async () => {
    enable()
    const t = fakeTools(db)
    const results = []
    for (let i = 0; i < 12; i++) results.push((await reserveCall(LIVE, t, 'commander', 'u1')).ok)
    expect(results.filter(Boolean)).toHaveLength(10)
    expect(await reserveCall(LIVE, t, 'commander', 'u2')).toEqual({ ok: true })
  })
})

describe('mapOwm', () => {
  it('maps icon codes and day/night', () => {
    expect(mapOwm('x', { ...OWM, icon: '01d', dt: 5, sunrise: 1, sunset: 10 }, 0)).toMatchObject({ condition: 'clear', isNight: false })
    expect(mapOwm('x', { ...OWM, icon: '13d', dt: 50, sunrise: 1, sunset: 10 }, 0)).toMatchObject({ condition: 'snow', isNight: true })
    expect(mapOwm('x', { description: 'no temp' }, 0)).toBeNull()
  })
})

describe('owner ops', () => {
  const env = { OWNER_USER_ID: 'owner' } as never
  it('only the owner can read status or flip the switch', async () => {
    const t = fakeTools(db)
    expect((await getOpsStatus({ userId: 'mallory', params: {}, tools: t, env, callerJwt: '' })).success).toBe(false)
    expect((await setIntegrationsEnabled({ userId: 'mallory', params: { enabled: true }, tools: t, env, callerJwt: '' })).success).toBe(false)
    expect(db.get('settings')).toBeUndefined()
    expect((await setIntegrationsEnabled({ userId: 'owner', params: { enabled: true }, tools: t, env, callerJwt: '' })).success).toBe(true)
    const s = await getOpsStatus({ userId: 'owner', params: {}, tools: t, env, callerJwt: '' })
    expect(s.success && s.data).toMatchObject({ mode: 'mock', integrationsEnabled: true })
  })
})
