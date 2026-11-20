/**
 * Cost safety for every paid integration call (plan §6):
 *   1. mock mode unless env INTEGRATIONS_MODE === 'live'
 *   2. owner kill switch: settings row 'integrationsEnabled' must be 'true' (default OFF)
 *   3. per-user and global daily caps, counted in the `usage` collection
 * If any check fails, callers fall back (mock weather / default plan / no email).
 * Counters are reserved BEFORE the call, so a failed call still counts: caps err on the safe side.
 */
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { utcDate } from '../game/daily'

export type UsageKind = 'weather' | 'commander' | 'email'

export const CAPS: Record<UsageKind, { global: number; perUser: number | null }> = {
  weather: { global: 7 * 48, perUser: null }, // ≤ one fetch per city per 30 min
  commander: { global: 150, perUser: 10 },
  email: { global: 30, perUser: 3 },
}

export const KILL_SWITCH_KEY = 'integrationsEnabled'

export function liveMode(env: Pick<Env, 'INTEGRATIONS_MODE'>): boolean {
  return env.INTEGRATIONS_MODE === 'live'
}

export async function killSwitchOn(tools: ActionTools): Promise<boolean> {
  const r = await tools.get('settings', KILL_SWITCH_KEY)
  if (!r.success) return false
  return (r.data.record.data as { value?: string }).value === 'true'
}

async function count(tools: ActionTools, id: string): Promise<number> {
  const r = await tools.get('usage', id)
  return r.success ? Number((r.data.record.data as { count?: number }).count ?? 0) : 0
}

async function bump(tools: ActionTools, date: string, kind: UsageKind, scope: string, current: number) {
  await tools.create('usage', { date, kind, scope, count: current + 1 }, `${date}:${kind}:${scope}`)
}

export type Permit = { ok: true } | { ok: false; reason: 'mock' | 'disabled' | 'global-cap' | 'user-cap' }

/**
 * Decide whether a real paid call may happen now, and if so count it.
 * `userId` is the signed-in caller (sign-in is enforced by the action route).
 */
export async function reserveCall(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools, kind: UsageKind, userId: string, nowMs = Date.now(),
): Promise<Permit> {
  if (!liveMode(env)) return { ok: false, reason: 'mock' }
  if (!(await killSwitchOn(tools))) return { ok: false, reason: 'disabled' }

  const date = utcDate(new Date(nowMs))
  const caps = CAPS[kind]
  const g = await count(tools, `${date}:${kind}:global`)
  if (g >= caps.global) return { ok: false, reason: 'global-cap' }
  let u = 0
  if (caps.perUser !== null) {
    u = await count(tools, `${date}:${kind}:${userId}`)
    if (u >= caps.perUser) return { ok: false, reason: 'user-cap' }
  }
  await bump(tools, date, kind, 'global', g)
  if (caps.perUser !== null) await bump(tools, date, kind, userId, u)
  console.info(`[usage] ${kind} real call #${g + 1} today (user ${userId})`)
  return { ok: true }
}
