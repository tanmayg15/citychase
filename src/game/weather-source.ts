/**
 * Where weather snapshots come from. Pure functions shared by server and tests:
 * the mock fixtures (default in development and whenever real calls are off)
 * and the mapping from the openweathermap/current response to a snapshot.
 */
import type { WeatherSnapshot } from '../engine'

export type WeatherSource = 'live' | 'mock' | 'stale' | 'preset'

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
  'rome-centro': 'Rome,IT',
  'berlin-mitte': 'Berlin,DE',
  'seoul-gangnam': 'Seoul,KR',
  'singapore-chinatown': 'Singapore,SG',
  'dubai-deira': 'Dubai,AE',
  'sydney-cbd': 'Sydney,AU',
  'rio-centro': 'Rio de Janeiro,BR',
  'istanbul-beyoglu': 'Istanbul,TR',
  'toronto-downtown': 'Toronto,CA',
  'amsterdam-centrum': 'Amsterdam,NL',
  'chicago-loop': 'Chicago,US',
  'delhi-cp': 'New Delhi,IN',
  'bengaluru-mg-road': 'Bengaluru,IN',
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
  'rome-centro': { condition: 'clear', tempC: 22, windSpeed: 3, windDeg: 200, description: 'sunny (mock)' },
  'berlin-mitte': { condition: 'drizzle', tempC: 7, windSpeed: 6, windDeg: 250, description: 'drizzle (mock)' },
  'seoul-gangnam': { condition: 'clouds', tempC: 9, windSpeed: 4, windDeg: 300, description: 'overcast (mock)' },
  'singapore-chinatown': { condition: 'thunderstorm', tempC: 30, windSpeed: 5, windDeg: 180, description: 'thunderstorm (mock)' },
  'dubai-deira': { condition: 'clear', tempC: 34, windSpeed: 4, windDeg: 320, description: 'hot sun (mock)' },
  'sydney-cbd': { condition: 'clear', tempC: 24, windSpeed: 9, windDeg: 140, description: 'breezy (mock)' },
  'rio-centro': { condition: 'clear', tempC: 29, windSpeed: 3, windDeg: 120, description: 'hot and humid (mock)' },
  'istanbul-beyoglu': { condition: 'rain', tempC: 11, windSpeed: 7, windDeg: 30, description: 'rain (mock)' },
  'toronto-downtown': { condition: 'snow', tempC: -3, windSpeed: 6, windDeg: 290, description: 'light snow (mock)' },
  'amsterdam-centrum': { condition: 'clouds', tempC: 8, windSpeed: 11, windDeg: 240, description: 'windy (mock)' },
  'chicago-loop': { condition: 'clear', tempC: 4, windSpeed: 13, windDeg: 280, description: 'windy city (mock)' },
  'delhi-cp': { condition: 'mist', tempC: 21, windSpeed: 2, windDeg: 0, description: 'smog (mock)' },
  'bengaluru-mg-road': { condition: 'clouds', tempC: 24, windSpeed: 3, windDeg: 90, description: 'pleasant (mock)' },
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

/** Weather a player can pick in Free Play. 'live' = the city's real current weather. */
export const WEATHER_PRESETS = ['live', 'clear', 'rain', 'snow', 'wind', 'heat', 'night', 'fog'] as const
export type WeatherPreset = (typeof WEATHER_PRESETS)[number]

export function isPreset(x: unknown): x is WeatherPreset {
  return typeof x === 'string' && (WEATHER_PRESETS as readonly string[]).includes(x)
}

export function presetWeather(cityId: string, preset: Exclude<WeatherPreset, 'live'>, nowMs: number): WeatherRecord {
  const base = { cityId, source: 'preset' as WeatherSource, fetchedAtMs: nowMs, isNight: false, windSpeed: 2, windDeg: 0, tempC: 18 }
  switch (preset) {
    case 'clear': return { ...base, condition: 'clear', description: 'clear sky' }
    case 'rain': return { ...base, condition: 'rain', tempC: 12, description: 'heavy rain' }
    case 'snow': return { ...base, condition: 'snow', tempC: -2, description: 'snow' }
    case 'wind': return { ...base, condition: 'clear', windSpeed: 15, windDeg: 270, description: 'gale-force wind' }
    case 'heat': return { ...base, condition: 'clear', tempC: 36, description: 'heatwave' }
    case 'night': return { ...base, condition: 'clear', isNight: true, tempC: 14, description: 'clear night' }
    case 'fog': return { ...base, condition: 'mist', tempC: 10, description: 'thick fog' }
  }
}
