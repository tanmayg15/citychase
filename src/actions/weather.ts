/**
 * Live weather per city with a shared 30-minute cache.
 * Order: fresh cache → real call (if mode, kill switch and caps allow) →
 * stale cache → mock fixture. The game never waits on, or breaks because of, weather.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getCity } from '../cities'
import { mapOwm, mockWeather, OWM_QUERY, type OwmCurrent, type WeatherRecord } from '../game/weather-source'
import { reserveCall } from './guard'

export const WEATHER_TTL_MS = 30 * 60 * 1000

interface CacheRow { weather: WeatherRecord; fetchedAtMs: number; source: string }

export async function resolveWeather(
  env: Pick<Env, 'INTEGRATIONS_MODE'>, tools: ActionTools, cityId: string, userId: string, nowMs = Date.now(),
): Promise<WeatherRecord> {
  const city = getCity(cityId)
  if (!city) throw new Error(`unknown city ${cityId}`)

  const cached = await tools.get('weatherCache', cityId)
  const row = cached.success ? (cached.data.record.data as unknown as CacheRow) : null
  // Mock results are cached too, but never block a real fetch once live mode is on.
  if (row && nowMs - row.fetchedAtMs < WEATHER_TTL_MS && row.source === 'live') return row.weather

  const permit = await reserveCall(env, tools, 'weather', userId, nowMs)
  if (permit.ok) {
    try {
      const r = await tools.integration<OwmCurrent>('openweathermap/current', { q: OWM_QUERY[cityId], units: 'metric' })
      const live = r.success ? mapOwm(cityId, r.data, nowMs) : null
      if (live) {
        await tools.create('weatherCache', { cityId, weather: live, fetchedAtMs: nowMs, source: 'live' }, cityId)
        return live
      }
      console.warn(`[weather] ${cityId}: unusable response`, r.success ? 'bad shape' : r.error)
    } catch (e) {
      console.warn(`[weather] ${cityId}: call failed`, (e as Error).message)
    }
  }

  if (row && row.source === 'live') return { ...row.weather, source: 'stale' }
  const mock = mockWeather(cityId, city.timezone, nowMs)
  if (!row || nowMs - row.fetchedAtMs >= WEATHER_TTL_MS) {
    await tools.create('weatherCache', { cityId, weather: mock, fetchedAtMs: nowMs, source: 'mock' }, cityId)
  }
  return mock
}

/** Signed-in only (enforced by the action route). Used by the home page HUD. */
export const getWeather: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const cityId = params.cityId
  if (typeof cityId !== 'string' || !getCity(cityId)) return { success: false, error: 'unknown city' }
  return { success: true, data: await resolveWeather(env, tools, cityId, userId) }
}

/**
 * Guests never trigger a paid call: they get the shared cached live weather
 * (marked stale if older than the TTL) or the demo fixture.
 */
export async function cachedWeather(tools: ActionTools, cityId: string, nowMs = Date.now()): Promise<WeatherRecord> {
  const city = getCity(cityId)
  if (!city) throw new Error(`unknown city ${cityId}`)
  const cached = await tools.get('weatherCache', cityId)
  const row = cached.success ? (cached.data.record.data as unknown as CacheRow) : null
  if (row && row.source === 'live') {
    return nowMs - row.fetchedAtMs < WEATHER_TTL_MS ? row.weather : { ...row.weather, source: 'stale' }
  }
  return mockWeather(cityId, city.timezone, nowMs)
}
