/**
 * Shared game setup used by both the browser and the server actions.
 * The daily city is a pure function of the UTC date: no cron, no stored row.
 */
import { CITY_MAZES, cityMaze, getCity } from '../cities'
import {
  CLEAR_WEATHER, seedFromString, weatherToModifiers,
  type CommanderPlan, type GameConfig, type WeatherSnapshot,
} from '../engine'

export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface Daily {
  date: string
  cityId: string
  /** Same for everyone today. Each attempt mixes in a server salt (see runSeed). */
  dailySeed: number
}

export function dailyFor(date: string): Daily {
  const h = seedFromString(`citychase:${date}`)
  return { date, cityId: CITY_MAZES[h % CITY_MAZES.length].id, dailySeed: seedFromString(`seed:${date}`) }
}

/**
 * Seed for one attempt. The maze and city are shared by everyone, but ghost
 * randomness differs per attempt, so copying someone else's public input log
 * does not reproduce their score.
 */
export function runSeed(dailySeed: number, salt: number): number {
  return (dailySeed ^ salt) >>> 0
}

export function buildConfig(opts: {
  cityId: string
  seed: number
  weather?: WeatherSnapshot
  plan: CommanderPlan
}): GameConfig {
  const city = getCity(opts.cityId)
  if (!city) throw new Error(`unknown city ${opts.cityId}`)
  return {
    maze: cityMaze(city),
    seed: opts.seed,
    modifiers: weatherToModifiers(opts.weather ?? CLEAR_WEATHER),
    plan: opts.plan,
  }
}

/** "🏙️ Tokyo · 🌧️ · 48,200 · top 6%" */
export function shareString(o: { city: string; weatherEmoji: string; score: number; topPercent: number | null }): string {
  const parts = [`🏙️ ${o.city}`, o.weatherEmoji, o.score.toLocaleString('en-US')]
  if (o.topPercent !== null) parts.push(`top ${o.topPercent}%`)
  return parts.join(' · ')
}

export function weatherEmoji(w: WeatherSnapshot): string {
  if (w.condition === 'snow') return '❄️'
  if (w.condition === 'rain' || w.condition === 'drizzle') return '🌧️'
  if (w.condition === 'thunderstorm') return '⛈️'
  if (w.windSpeed >= 8) return '💨'
  if (w.isNight) return '🌙'
  if (w.condition === 'clouds' || w.condition === 'mist') return '☁️'
  return '☀️'
}

/** "🌧️ Tokyo, light rain, 14°C, 21:40 local" */
export function weatherLabel(
  city: string, timezone: string, w: WeatherSnapshot & { description?: string }, now: Date = new Date(),
): string {
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(now)
  return `${weatherEmoji(w)} ${city}, ${w.description || w.condition}, ${w.tempC}°C, ${local} local`
}

const ARROWS = ['', '↑', '→', '↓', '←']

/** Short labels for the weather rules currently in effect. */
export function ruleBadges(w: WeatherSnapshot): string[] {
  const m = weatherToModifiers(w)
  const out: string[] = []
  if (m.slipTiles) out.push('Wet roads: your car slides')
  if (m.wind) out.push(`Crosswind pushes patrols ${ARROWS[m.wind.dir]}`)
  if (m.visionRadius !== null) out.push('Night: short sight, shorter headlights')
  if (m.powerTicks > 100) out.push('Heat: smoke lasts longer')
  if (out.length === 0) out.push('Clear: no modifiers')
  return out
}
