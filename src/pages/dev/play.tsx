/**
 * Practice / debug page: plays any city locally with no sign-in and no
 * submission. Scores here are NOT verified and never reach the leaderboard.
 */
import { useMemo, useState } from 'react'
import { CITY_MAZES } from '@/cities'
import { CLEAR_WEATHER, DEFAULT_PLAN, MAX_TICKS, type WeatherSnapshot } from '@/engine'
import { buildConfig } from '@/game/daily'
import { GameCanvas, type Hud } from '@/game/GameCanvas'
import { HudBar } from '@/game/HudBar'

const WEATHERS: Record<string, WeatherSnapshot> = {
  clear: CLEAR_WEATHER,
  rain: { ...CLEAR_WEATHER, condition: 'rain' },
  wind: { ...CLEAR_WEATHER, windSpeed: 15, windDeg: 270 },
  night: { ...CLEAR_WEATHER, isNight: true },
  heat: { ...CLEAR_WEATHER, tempC: 33 },
}

export default function PracticePage() {
  const [cityId, setCityId] = useState(CITY_MAZES[0].id)
  const [weather, setWeather] = useState('clear')
  const [game, setGame] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)
  const [last, setLast] = useState<string>('')
  const cfg = useMemo(
    () => buildConfig({ cityId, seed: 1000 + game, weather: WEATHERS[weather], plan: DEFAULT_PLAN }),
    [cityId, weather, game],
  )

  return (
    <main className="min-h-screen px-3 py-4 text-[#e8e0ff]" style={{ background: '#07030f' }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <strong>Practice (unverified)</strong>
          <select value={cityId} onChange={(e) => { setCityId(e.target.value); setGame((g) => g + 1) }} className="rounded bg-white/10 px-2 py-1">
            {CITY_MAZES.map((c) => <option key={c.id} value={c.id}>{c.city}: {c.name}</option>)}
          </select>
          <select value={weather} onChange={(e) => { setWeather(e.target.value); setGame((g) => g + 1) }} className="rounded bg-white/10 px-2 py-1" data-testid="weather-select">
            {Object.keys(WEATHERS).map((w) => <option key={w}>{w}</option>)}
          </select>
          <button onClick={() => setGame((g) => g + 1)} className="rounded bg-cyan-400 px-3 py-1 font-bold text-black">Restart</button>
          {hud && <HudBar hud={hud} />}
          {hud?.countdown ? <span>starts in {hud.countdown}</span> : null}
          {last && <span className="opacity-70">{last}</span>}
        </div>
        <GameCanvas
          key={game}
          cfg={cfg}
          maxTicks={MAX_TICKS}
          onHud={setHud}
          onEnd={(log, s) => setLast(`Last game: ${s.status}, ${s.score} pts, ${s.lootTaken} loot, ${log.length} inputs`)}
        />
      </div>
    </main>
  )
}
