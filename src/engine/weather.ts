import { Dir, type WeatherModifiers } from './types'

/** The stored weather snapshot. Saved with each run so replays stay deterministic. */
export interface WeatherSnapshot {
  condition: 'clear' | 'clouds' | 'rain' | 'drizzle' | 'thunderstorm' | 'snow' | 'mist'
  /** Rounded °C. */
  tempC: number
  /** Rounded m/s. */
  windSpeed: number
  /** Meteorological degrees: the direction the wind blows FROM. */
  windDeg: number
  isNight: boolean
}

export const BASE_POWER_TICKS = 100 // smoke: 5 s at 20 ticks/s
export const HEAT_POWER_TICKS = 160
export const DAY_COP_VISION = 8
export const NIGHT_COP_VISION = 5
export const HEAT_THRESHOLD_C = 28
export const STRONG_WIND_MS = 8
export const GALE_WIND_MS = 14
export const NIGHT_VISION_RADIUS = 5

export const CLEAR_WEATHER: WeatherSnapshot = {
  condition: 'clear',
  tempC: 18,
  windSpeed: 2,
  windDeg: 0,
  isNight: false,
}

/** Wind FROM the north blows cars south (down the grid), and so on. */
export function windDirFromDegrees(deg: number): Dir {
  const d = ((Math.round(deg) % 360) + 360) % 360
  if (d >= 315 || d < 45) return Dir.Down
  if (d < 135) return Dir.Left
  if (d < 225) return Dir.Up
  return Dir.Right
}

export function weatherToModifiers(w: WeatherSnapshot): WeatherModifiers {
  const wet = w.condition === 'rain' || w.condition === 'drizzle' ||
    w.condition === 'thunderstorm' || w.condition === 'snow'
  const windy = w.windSpeed >= STRONG_WIND_MS
  return {
    slipTiles: wet ? 1 : 0,
    wind: windy
      ? { dir: windDirFromDegrees(w.windDeg), every: w.windSpeed >= GALE_WIND_MS ? 6 : 10 }
      : null,
    visionRadius: w.isNight ? NIGHT_VISION_RADIUS : null,
    copVision: w.isNight ? NIGHT_COP_VISION : DAY_COP_VISION,
    powerTicks: w.tempC >= HEAT_THRESHOLD_C ? HEAT_POWER_TICKS : BASE_POWER_TICKS,
  }
}
