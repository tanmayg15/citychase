import { beforeEach, describe, expect, it } from 'vitest'
import { KILL_SWITCH_KEY } from './guard'
import { alertKnockedOff, cleanHeadline, getNews, getRadio, NEWS_TTL_MS, RADIO_LINES, relevantHeadline } from './media'
import { fakeTools, type Db } from './test-tools'

const LIVE = { INTEGRATIONS_MODE: 'live', APP_NAME: 'citychase' }
let db: Db
let calls: Array<{ endpoint: string; body: Record<string, unknown> }>
const tools = (resp: (endpoint: string) => unknown = () => ({})) =>
  fakeTools(db, { integration: (endpoint, body) => { calls.push({ endpoint, body: body as Record<string, unknown> }); return resp(endpoint) } })
const enable = () => db.set('settings', new Map([[KILL_SWITCH_KEY, { key: KILL_SWITCH_KEY, value: 'true' }]]))

beforeEach(() => { db = new Map(); calls = [] })

describe('relevantHeadline', () => {
  const tokyo = { city: 'Tokyo', name: 'Shibuya' }
  it('keeps city-life headlines that name the city or district', () => {
    expect(relevantHeadline('Tokyo opens a new skyline park this week', tokyo)).toBe(true)
    expect(relevantHeadline('Heavy rain snarls Shibuya crossing traffic', tokyo)).toBe(true)
  })
  it('drops headlines that do not name the city', () => {
    expect(relevantHeadline('Rain expected across the region', tokyo)).toBe(false)
  })
  it('drops markets, politics and violent crime even when the city is named', () => {
    expect(relevantHeadline('Trump buys Nvidia stock in Tokyo deal', tokyo)).toBe(false)
    expect(relevantHeadline('Kim Jong Un talks collapse after Tokyo summit', tokyo)).toBe(false)
    expect(relevantHeadline('Two killed in Tokyo shooting', tokyo)).toBe(false)
  })
})

describe('news ticker', () => {
  const news = () => ({ headlines: ['Tokyo opens a new skyline park this week', 'Tokyo opens a new skyline park this week', 'short', '[Removed]', 'Rain expected across Tokyo through the weekend'] })

  it('fetches once, de-duplicates and cleans, then serves the cache for an hour', async () => {
    enable()
    const t0 = 1_800_000_000_000
    const a = await getNews(LIVE, tools(news), 'tokyo-shibuya', 'u', t0)
    expect(a).toEqual(['Tokyo opens a new skyline park this week', 'Rain expected across Tokyo through the weekend'])
    await getNews(LIVE, tools(news), 'tokyo-shibuya', 'u', t0 + NEWS_TTL_MS - 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe('newsapi/search-everything')
  })

  it('no call when the kill switch is off or in mock mode', async () => {
    expect(await getNews(LIVE, tools(news), 'tokyo-shibuya', 'u')).toEqual([])
    enable()
    expect(await getNews({}, tools(news), 'tokyo-shibuya', 'u')).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('asks NewsAPI for local topics only, and filters off-topic results (also from an older cache)', async () => {
    enable()
    const mixed = () => ({ headlines: ['Tokyo metro adds late-night trains', 'Trump buys Nvidia stock as Tokyo markets rally'] })
    expect(await getNews(LIVE, tools(mixed), 'tokyo-shibuya', 'u')).toEqual(['Tokyo metro adds late-night trains'])
    expect(String(calls[0].body.q)).toContain('traffic')
    db.set('newsCache', new Map([['tokyo-shibuya', { cityId: 'tokyo-shibuya', headlines: ['Two killed in Tokyo shooting', 'Tokyo festival lights up Shibuya'], fetchedAtMs: Date.now() }]]))
    expect(await getNews(LIVE, tools(mixed), 'tokyo-shibuya', 'u')).toEqual(['Tokyo festival lights up Shibuya'])
  })

  it('cleanHeadline trims and caps length', () => {
    expect(cleanHeadline(`  ${'x'.repeat(200)}  `)!.length).toBe(138)
    expect(cleanHeadline(42)).toBeNull()
  })
})

describe('radio voices', () => {
  const tts = () => ({ audioUrl: 'data:audio/mpeg;base64,AAAA' })

  it('generates at most maxNew lines per request and caches them forever', async () => {
    enable()
    const first = await getRadio(LIVE, tools(tts), 'u', 2)
    expect(Object.keys(first)).toHaveLength(2)
    const second = await getRadio(LIVE, tools(tts), 'u', 100)
    expect(Object.keys(second)).toHaveLength(Object.keys(RADIO_LINES).length)
    const before = calls.length
    await getRadio(LIVE, tools(tts), 'u', 100)
    expect(calls.length).toBe(before) // all cached now
  })

  it('rejects anything that is not an audio data URL', async () => {
    enable()
    const r = await getRadio(LIVE, tools(() => ({ audioUrl: 'https://evil.example/x.mp3' })), 'u', 1)
    expect(r).toEqual({})
  })
})

describe('email alerts', () => {
  const base = { board: 'daily:2026-11-20', cityId: 'paris-marais', prevScore: 900, newName: 'Bob', newScore: 1200, appUrl: 'https://citychase.app.space/' }
  const user = (id: string, optIn: boolean) => {
    db.set('users', new Map([[id, { email: `${id}@example.com` }]]))
    db.set('prefs', new Map([[id, { userId: id, emailAlerts: optIn }]]))
  }

  it('emails the previous #1 only if they opted in', async () => {
    enable(); user('alice', true)
    expect(await alertKnockedOff(LIVE, tools(), { ...base, prevUserId: 'alice' })).toBe(true)
    expect(calls[0]).toMatchObject({ endpoint: 'email/send', body: { to: 'alice@example.com' } })
    expect(String(calls[0].body.subject)).toContain('Bob just took your #1 spot in Paris')
  })

  it('never emails without opt-in, or a guest', async () => {
    enable(); user('alice', false)
    expect(await alertKnockedOff(LIVE, tools(), { ...base, prevUserId: 'alice' })).toBe(false)
    expect(await alertKnockedOff(LIVE, tools(), { ...base, prevUserId: 'guest_abc' })).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('caps emails received per player per day at 3', async () => {
    enable(); user('alice', true)
    const sent = []
    for (let i = 0; i < 5; i++) sent.push(await alertKnockedOff(LIVE, tools(), { ...base, prevUserId: 'alice' }))
    expect(sent.filter(Boolean)).toHaveLength(3)
  })

  it('escapes HTML in names', async () => {
    enable(); user('alice', true)
    await alertKnockedOff(LIVE, tools(), { ...base, prevUserId: 'alice', newName: '<script>x</script>' })
    expect(String(calls[0].body.html)).not.toContain('<script>')
  })
})
