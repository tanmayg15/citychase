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

// ─── A finished guest run waiting for sign-in (survives the OAuth redirect) ───

const PENDING_KEY = 'citychase:pendingClaim'

export interface PendingClaim {
  ticket: string
  inputLog: Array<[number, number]>
  localScore: number
  outcome: string
  cityId: string
  board: string
  savedAtMs: number
}

export function savePending(p: PendingClaim): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)) } catch { /* storage blocked */ }
}

export function loadPending(): PendingClaim | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingClaim
    // Tickets expire server-side after an hour; don't offer stale ones.
    return Date.now() - p.savedAtMs < 55 * 60 * 1000 ? p : null
  } catch {
    return null
  }
}

export function clearPending(): void {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* storage blocked */ }
}
