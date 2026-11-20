/**
 * Where weather snapshots come from. Pure functions shared by server and tests:
 * the mock fixtures (default in development and whenever real calls are off)
 * and the mapping from the openweathermap/current response to a snapshot.
 */
import type { WeatherSnapshot } from '../engine'

export type WeatherSource = 'live' | 'mock' | 'stale'

/** A snapshot plus where it came from. Stored in weatherCache and on each run. */
export interface WeatherRecord extends WeatherSnapshot {
  cityId: string
  source: WeatherSource
  description: string
  fetchedAtMs: number
}

/** `q` parameter for openweathermap/current, per city. */
export const OWM_QUERY: Record<string, string> = {
  'nyc-midtown': 'New York,US',
  'tokyo-shibuya': 'Tokyo,JP',
  'paris-marais': 'Paris,FR',
  'london-soho': 'London,GB',
  'barcelona-eixample': 'Barcelona,ES',
  'mumbai-fort': 'Mumbai,IN',
  'sf-mission': 'San Francisco,US',
}

/** Varied on purpose so every rule shows up in mock mode. */
const MOCK: Record<string, Omit<WeatherSnapshot, 'isNight'> & { description: string }> = {
  'nyc-midtown': { condition: 'clouds', tempC: 9, windSpeed: 5, windDeg: 300, description: 'broken clouds (mock)' },
  'tokyo-shibuya': { condition: 'rain', tempC: 14, windSpeed: 3, windDeg: 40, description: 'light rain (mock)' },
  'paris-marais': { condition: 'drizzle', tempC: 11, windSpeed: 4, windDeg: 220, description: 'drizzle (mock)' },
  'london-soho': { condition: 'clouds', tempC: 10, windSpeed: 10, windDeg: 250, description: 'windy, overcast (mock)' },
  'barcelona-eixample': { condition: 'clear', tempC: 19, windSpeed: 3, windDeg: 90, description: 'clear sky (mock)' },
  'mumbai-fort': { condition: 'clear', tempC: 31, windSpeed: 4, windDeg: 270, description: 'hot and hazy (mock)' },
  'sf-mission': { condition: 'mist', tempC: 15, windSpeed: 9, windDeg: 270, description: 'fog and wind (mock)' },
}

export function localHour(timezone: string, nowMs: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(nowMs))
}

export function mockWeather(cityId: string, timezone: string, nowMs: number): WeatherRecord {
  const m = MOCK[cityId] ?? MOCK['barcelona-eixample']
  const h = localHour(timezone, nowMs)
  return {
    ...m, cityId, isNight: h < 6 || h >= 19, source: 'mock', fetchedAtMs: nowMs,
  }
}

export interface OwmCurrent {
  dt?: number
  temp?: number
  description?: string
  icon?: string
  wind_speed?: number
  wind_deg?: number
  sunrise?: number
  sunset?: number
}

/** Map OpenWeatherMap's icon code (e.g. "10n") to our condition. */
function conditionFromIcon(icon: string): WeatherSnapshot['condition'] {
  switch (icon.slice(0, 2)) {
    case '01': return 'clear'
    case '02': case '03': case '04': return 'clouds'
    case '09': return 'drizzle'
    case '10': return 'rain'
    case '11': return 'thunderstorm'
    case '13': return 'snow'
    case '50': return 'mist'
    default: return 'clear'
  }
}

/** Returns null if the response is missing the fields we need. */
export function mapOwm(cityId: string, r: OwmCurrent, nowMs: number): WeatherRecord | null {
  if (typeof r.temp !== 'number' || typeof r.icon !== 'string') return null
  const dt = r.dt ?? Math.floor(nowMs / 1000)
  const isNight = r.icon.endsWith('n') ||
    (typeof r.sunrise === 'number' && typeof r.sunset === 'number' && (dt < r.sunrise || dt > r.sunset))
  return {
    cityId,
    condition: conditionFromIcon(r.icon),
    tempC: Math.round(r.temp),
    windSpeed: Math.round(r.wind_speed ?? 0),
    windDeg: Math.round(r.wind_deg ?? 0),
    isNight,
    description: (r.description ?? '').slice(0, 60),
    source: 'live',
    fetchedAtMs: nowMs,
  }
}

/** Only these fields reach the engine; the rest is display metadata. */
export function toSnapshot(w: WeatherSnapshot): WeatherSnapshot {
  return { condition: w.condition, tempC: w.tempC, windSpeed: w.windSpeed, windDeg: w.windDeg, isNight: w.isNight }
}
