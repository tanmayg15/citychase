/**
 * The three "flavour" integrations, all owner-paid and gated by guard.ts
 * (live mode + owner kill switch + daily caps + usage log):
 *
 *   NewsAPI     real headlines about today's city for the lobby ticker
 *               (cached 1 h per city, shared by everyone)
 *   ElevenLabs  police radio voice clips, generated once per line and cached
 *   Resend      opt-in email when someone takes your #1 spot on a board
 *
 * Every function degrades silently: no key, cap hit, switch off or an
 * upstream error all mean "no news / no voice / no email", never a broken game.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getCity } from '../cities'
import { reserveCall } from './guard'

// ─── News ticker ────────────────────────────────────────────────────────────

export const NEWS_TTL_MS = 60 * 60 * 1000
const MAX_HEADLINES = 8

interface NewsRow { cityId: string; headlines: string[]; fetchedAtMs: number }

/** Clean a headline for display (React escapes it; this just trims noise and length). */
export function cleanHeadline(h: unknown): string | null {
  if (typeof h !== 'string') return null
  const t = h.replace(/\s+/g, ' ').trim()
  if (t.length < 12 || /\[removed\]/i.test(t)) return null
  return t.length > 140 ? `${t.slice(0, 137)}…` : t
}

/**
 * Only city-life headlines belong in a game lobby. NewsAPI's "everything"
 * search returns any article that mentions the city (markets, geopolitics,
 * crime), so a headline must name the city and steer clear of those topics.
 */
const OFF_TOPIC = /\b(trump|biden|putin|kim jong|xi jinping|stock|stocks|shares|nvidia|crypto|bitcoin|ipo|earnings|tariff|sanction|election|war|missile|military|killed|kills|dead|death|murder|rape|shooting|stabbing|terror|suicide|abuse|porn|nsfw|lawsuit|sued)\b/i

export function relevantHeadline(h: string, city: { city: string; name: string }): boolean {
  const lower = h.toLowerCase()
  const names = [city.city, city.name].map((n) => n.toLowerCase())
  if (!names.some((n) => lower.includes(n))) return false
  return !OFF_TOPIC.test(h)
}

/** Topics that fit a getaway game's "local news" ticker. */
const NEWS_TOPICS = 'police OR traffic OR weather OR rain OR storm OR transport OR metro OR festival OR street OR road OR tourism OR food OR museum OR park'

export async function getNews(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools, cityId: string, callerId: string, nowMs = Date.now(),
): Promise<string[]> {
  const city = getCity(cityId)
  if (!city) return []
  const cached = await tools.get('newsCache', cityId)
  const row = cached.success ? (cached.data.record.data as unknown as NewsRow) : null
  const keep = (list: string[]) => list.filter((h) => relevantHeadline(h, city))
  if (row && nowMs - row.fetchedAtMs < NEWS_TTL_MS) return keep(row.headlines)

  const permit = await reserveCall(env, tools, 'news', callerId, nowMs)
  if (permit.ok) {
    try {
      const r = await tools.integration<{ headlines?: unknown[] }>('newsapi/search-everything', {
        q: `"${city.city}" AND (${NEWS_TOPICS})`, language: 'en', sortBy: 'publishedAt', pageSize: 40,
      })
      if (r.success) {
        const headlines = keep([...new Set((r.data.headlines ?? []).map(cleanHeadline).filter((h): h is string => !!h))]).slice(0, MAX_HEADLINES)
        if (headlines.length) {
          await tools.create('newsCache', { cityId, headlines, fetchedAtMs: nowMs }, cityId)
          return headlines
        }
      } else {
        console.warn(`[news] ${cityId}: ${r.error}`)
      }
    } catch (e) {
      console.warn(`[news] ${cityId}: ${(e as Error).message}`)
    }
  }
  return keep(row?.headlines ?? [])
}

// ─── Police radio voices ────────────────────────────────────────────────────

import { RADIO_LINES } from '../shared/radio-lines'
export { RADIO_LINES }
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb' // ElevenLabs' default voice from the integration spec

interface RadioRow { lineId: string; text: string; audioUrl: string }

/**
 * Return all radio clips that exist; generate at most `maxNew` missing ones
 * (only when integrations are on and within the cap).
 */
export async function getRadio(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools, callerId: string, maxNew = 2,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let made = 0
  for (const [lineId, text] of Object.entries(RADIO_LINES)) {
    const got = await tools.get('radioCache', lineId)
    if (got.success) {
      const row = got.data.record.data as unknown as RadioRow
      if (row.text === text) { out[lineId] = row.audioUrl; continue }
    }
    if (made >= maxNew) continue
    const permit = await reserveCall(env, tools, 'tts', callerId)
    if (!permit.ok) continue
    made++
    try {
      const r = await tools.integration<{ audioUrl?: string }>('elevenlabs/generate-speech', {
        text, voice_id: VOICE_ID, model_id: 'eleven_flash_v2_5', output_format: 'mp3_22050_32',
      })
      const url = r.success ? r.data.audioUrl : undefined
      if (url && url.startsWith('data:audio/') && url.length < 400_000) {
        await tools.create('radioCache', { lineId, text, audioUrl: url }, lineId)
        out[lineId] = url
      } else {
        console.warn(`[radio] ${lineId}: unusable response`, r.success ? 'bad url' : r.error)
      }
    } catch (e) {
      console.warn(`[radio] ${lineId}: ${(e as Error).message}`)
    }
  }
  return out
}

// ─── Email alerts ───────────────────────────────────────────────────────────

export const setAlerts: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (typeof params.enabled !== 'boolean') return { success: false, error: 'enabled must be boolean' }
  const r = await tools.create('prefs', { userId, emailAlerts: params.enabled }, userId)
  return r.success ? { success: true, data: { emailAlerts: params.enabled } } : r
}

export const getPrefs: ActionHandler<Env> = async ({ userId, tools }) => {
  const r = await tools.get('prefs', userId)
  const emailAlerts = r.success ? Boolean((r.data.record.data as { emailAlerts?: boolean }).emailAlerts) : false
  return { success: true, data: { emailAlerts } }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Someone just took the #1 spot on `board` from `prevUserId`. Email them if
 * they opted in. Never throws; never blocks the run being saved.
 */
export async function alertKnockedOff(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools,
  o: { board: string; cityId: string; prevUserId: string; prevScore: number; newName: string; newScore: number; appUrl: string },
): Promise<boolean> {
  try {
    if (o.prevUserId.startsWith('guest_')) return false
    const prefs = await tools.get('prefs', o.prevUserId)
    if (!prefs.success || !(prefs.data.record.data as { emailAlerts?: boolean }).emailAlerts) return false
    const u = await tools.get('users', o.prevUserId)
    const email = u.success ? (u.data.record.data as { email?: string }).email : undefined
    if (!email) return false
    // Per-user cap counts emails *received* by that player.
    const permit = await reserveCall(env, tools, 'email', o.prevUserId)
    if (!permit.ok) return false
    const city = getCity(o.cityId)?.city ?? 'the city'
    const kind = o.board.startsWith('daily:') ? "today's heist" : `${city} free play`
    const subject = `${o.newName} just took your #1 spot in ${city}`
    const text = `${o.newName} scored ${o.newScore.toLocaleString('en-US')} on ${kind}, beating your ${o.prevScore.toLocaleString('en-US')}.\n\nWin it back: ${o.appUrl}\n\nYou get this because you turned on score alerts in City Chase. Turn them off in the lobby any time.`
    const html = `<p><strong>${escapeHtml(o.newName)}</strong> scored <strong>${o.newScore.toLocaleString('en-US')}</strong> on ${escapeHtml(kind)}, beating your ${o.prevScore.toLocaleString('en-US')}.</p><p><a href="${escapeHtml(o.appUrl)}">Win it back →</a></p><p style="color:#888;font-size:12px">You get this because you turned on score alerts in City Chase. Turn them off in the lobby any time.</p>`
    const r = await tools.integration('email/send', { to: email, subject, text, html })
    if (!r.success) console.warn(`[email] ${r.error}`)
    return r.success
  } catch (e) {
    console.warn(`[email] ${(e as Error).message}`)
    return false
  }
}
