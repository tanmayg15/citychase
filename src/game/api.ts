/** Thin client for the app's server actions and the public guest-start route. */
import { getAuthToken } from 'deepspace'

export async function callAction<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Please sign in first.')
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}

/** No sign-in: returns a server-signed run ticket plus the run setup. */
export async function guestStart<T>(params: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/guest/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}

// ─── Guest identity ─────────────────────────────────────────────────────────
// Issued by the server on the first guest run (signed token) and kept in this
// browser. Guest scores go on the board as "Guest 1234"; signing in moves them
// to the account (claimGuest).

const GUEST_KEY = 'citychase:guest'

export interface Guest {
  guestId: string
  guestToken: string
  guestName: string
}

export function loadGuest(): Guest | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY)
    return raw ? (JSON.parse(raw) as Guest) : null
  } catch {
    return null
  }
}

export function saveGuest(g: Guest): void {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)) } catch { /* storage blocked */ }
}

export function clearGuest(): void {
  try { localStorage.removeItem(GUEST_KEY) } catch { /* storage blocked */ }
}

/** Public: verify a guest run on the server and put it on the board. */
export async function guestSubmit<T>(params: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/guest/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}

/** After sign-in: move this browser's guest scores to the account, once. */
export async function claimGuestIfAny(): Promise<number> {
  const g = loadGuest()
  if (!g) return 0
  try {
    const r = await callAction<{ moved: number }>('claimGuest', { guestId: g.guestId, guestToken: g.guestToken })
    clearGuest()
    return r.moved
  } catch {
    return 0
  }
}
