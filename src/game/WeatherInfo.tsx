/** Weather line + active rule badges for a city, from the shared public cache. */
import { useEffect, useRef } from 'react'
import { useAuth, useQuery } from 'deepspace'
import type { CityMaze } from '../cities'
import { callAction } from './api'
import { ruleBadges, weatherLabel } from './daily'
import type { WeatherRecord } from './weather-source'

const TTL_MS = 30 * 60 * 1000

export function RuleBadges({ weather }: { weather: WeatherRecord }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="rule-badges">
      {ruleBadges(weather).map((b) => (
        <span key={b} className="rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 px-2.5 py-0.5 text-xs text-fuchsia-200">{b}</span>
      ))}
      {weather.source !== 'live' && (
        <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs opacity-60">
          {weather.source === 'mock' ? 'demo weather' : 'last known weather'}
        </span>
      )}
    </div>
  )
}

export function WeatherInfo({ city }: { city: CityMaze }) {
  const { records, status } = useQuery<{ cityId: string; weather: WeatherRecord; fetchedAtMs: number }>('weatherCache', { where: { cityId: city.id } })
  const { isSignedIn } = useAuth()
  const asked = useRef(false)
  const row = records[0]?.data

  // Signed-in visitors refresh a missing/old cache once. Signed-out visitors only read it.
  useEffect(() => {
    if (status !== 'ready' || !isSignedIn || asked.current) return
    if (row && Date.now() - row.fetchedAtMs < TTL_MS) return
    asked.current = true
    callAction('getWeather', { cityId: city.id }).catch(() => {})
  }, [status, isSignedIn, row, city.id])

  if (!row) return <p className="mt-1 text-sm opacity-60">Weather loads when you play.</p>
  return (
    <div data-testid="weather-info">
      <p className="mt-1 text-sm opacity-80">{weatherLabel(city.city, city.timezone, row.weather)}</p>
      <RuleBadges weather={row.weather} />
    </div>
  )
}
