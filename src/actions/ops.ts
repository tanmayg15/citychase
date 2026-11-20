/**
 * Owner-only controls: see the integration mode, flip the kill switch, read
 * today's usage. Gated on OWNER_USER_ID (the app owner), not just the admin role.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { utcDate } from '../game/daily'
import { CAPS, KILL_SWITCH_KEY, killSwitchOn, liveMode } from './guard'

function isOwner(env: Env, userId: string): boolean {
  return Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID
}

export const getOpsStatus: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (!isOwner(env, userId)) return { success: false, error: 'Forbidden: owner only' }
  const date = utcDate()
  const usage = await tools.query('usage', { where: { date }, limit: 500 })
  const rows = usage.success ? usage.data.records.map((r) => r.data as { kind: string; scope: string; count: number }) : []
  const global = Object.fromEntries(
    Object.keys(CAPS).map((k) => [k, rows.find((r) => r.kind === k && r.scope === 'global')?.count ?? 0]),
  )
  return {
    success: true,
    data: {
      date,
      mode: liveMode(env) ? 'live' : 'mock',
      integrationsEnabled: await killSwitchOn(tools),
      caps: CAPS,
      globalToday: global,
      perUserToday: rows.filter((r) => r.scope !== 'global'),
    },
  }
}

export const setIntegrationsEnabled: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!isOwner(env, userId)) return { success: false, error: 'Forbidden: owner only' }
  if (typeof params.enabled !== 'boolean') return { success: false, error: 'enabled must be boolean' }
  const r = await tools.create('settings', { key: KILL_SWITCH_KEY, value: String(params.enabled) }, KILL_SWITCH_KEY)
  if (!r.success) return r
  console.info(`[ops] integrationsEnabled=${params.enabled} by owner`)
  return { success: true, data: { integrationsEnabled: params.enabled } }
}
