/**
 * Guest run tickets: a server-signed description of one run, given to players
 * who are not signed in. After they sign in, they hand it back with their input
 * log (claimRun); the signature proves the server chose the seed, weather and
 * plan, so the replay is as trustworthy as a signed-in run. HMAC-SHA256 via
 * WebCrypto with the RUN_TICKET_SECRET secret. Stateless: nothing is stored
 * until the run is claimed (single use is enforced at claim time).
 */
import type { CommanderPlan } from '../engine'
import type { WeatherRecord } from '../game/weather-source'

export interface RunTicket {
  v: 1
  id: string
  mode: 'daily' | 'free'
  board: string
  date: string
  cityId: string
  seed: number
  weather: WeatherRecord
  plan: CommanderPlan
  engineVersion: number
  startedAtMs: number
}

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signTicket(secret: string, t: RunTicket): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(t)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

/** Returns the ticket if the signature is valid (constant-time check via WebCrypto verify), else null. */
export async function verifyTicket(secret: string, token: unknown): Promise<RunTicket | null> {
  if (typeof token !== 'string' || token.length > 8000) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(sig), enc.encode(body))
    if (!ok) return null
    const t = JSON.parse(new TextDecoder().decode(fromB64url(body))) as RunTicket
    return t && t.v === 1 && typeof t.id === 'string' ? t : null
  } catch {
    return null
  }
}

export function newTicketId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(12)))
}

// ─── Guest identities ──────────────────────────────────────────────────────
// A guest gets a random id plus an HMAC token proving the server issued it.
// Guest scores are stored under userId `guest_<id>`; signing in later moves
// them to the real account (claimGuest). Names are generated, never typed,
// so nobody can put offensive text on the leaderboard.

export interface GuestIdentity {
  guestId: string
  guestToken: string
  guestName: string
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(text)))
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function guestNameFor(guestId: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < guestId.length; i++) { h ^= guestId.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return `Guest ${1000 + ((h >>> 0) % 9000)}`
}

export async function newGuest(secret: string): Promise<GuestIdentity> {
  const guestId = newTicketId()
  return { guestId, guestToken: await hmacHex(secret, `guest:${guestId}`), guestName: guestNameFor(guestId) }
}

/** Constant-time compare of the presented token against the expected one. */
export async function verifyGuest(secret: string, guestId: unknown, guestToken: unknown): Promise<GuestIdentity | null> {
  if (typeof guestId !== 'string' || typeof guestToken !== 'string' || guestId.length > 40 || guestToken.length !== 32) return null
  const expected = await hmacHex(secret, `guest:${guestId}`)
  let diff = 0
  for (let i = 0; i < 32; i++) diff |= expected.charCodeAt(i) ^ guestToken.charCodeAt(i)
  return diff === 0 ? { guestId, guestToken, guestName: guestNameFor(guestId) } : null
}

export async function hashIp(secret: string, ip: string): Promise<string> {
  return (await hmacHex(secret, `ip:${ip}`)).slice(0, 16)
}
