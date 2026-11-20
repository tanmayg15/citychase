/**
 * The lobby: the one home page. A live 3D city (bot-played demo) behind the
 * menu; Today's heist, Free Play (any city, any weather), leaderboards and
 * sign-in. Playing never requires sign-in.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuth, useAuthUser, useQuery } from 'deepspace'
import { CITY_MAZES, getCity } from '@/cities'
import { AttractScene } from '@/game/AttractScene'
import { dailyFor, utcDate, weatherEmoji, weatherLabel } from '@/game/daily'
import { Leaderboard } from '@/game/Leaderboard'
import { getSfx } from '@/game/sound'
import { RuleBadges } from '@/game/WeatherInfo'
import { WEATHER_PRESETS, type WeatherPreset, type WeatherRecord } from '@/game/weather-source'

const WEATHER_LABEL: Record<WeatherPreset, string> = {
  live: '📡 Live', clear: '☀️ Clear', rain: '🌧️ Rain', snow: '❄️ Snow', wind: '💨 Wind', heat: '🔥 Heat', night: '🌙 Night', fog: '🌫️ Fog',
}

const TICKER = [
  'BREAKING: Getaway car spotted near the waterfront, units en route',
  'Police chief: "Our new dispatch system learns from every chase"',
  'Weather desk: rain makes roads slick, drivers slide on turns',
  'Smoke-bomb sightings up 300% this week, say officials',
  'Safehouse locations change daily, say anonymous sources',
]

export default function Lobby() {
  const navigate = useNavigate()
  const { isSignedIn } = useAuth()
  const { user } = useAuthUser()
  const [signIn, setSignIn] = useState(false)
  const daily = dailyFor(utcDate())
  const dailyCity = getCity(daily.cityId)!
  const [cityId, setCityId] = useState(CITY_MAZES[0].id)
  const [weather, setWeather] = useState<WeatherPreset>('live')
  const [board, setBoard] = useState<'daily' | 'free'>('daily')

  const { records } = useQuery<{ cityId: string; weather: WeatherRecord }>('weatherCache', { where: { cityId: daily.cityId } })
  const dailyWeather = records[0]?.data.weather
  const bgWeather = useMemo(() => dailyWeather, [dailyWeather?.fetchedAtMs]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (url: string) => {
    getSfx()?.resume() // unlock audio inside the click
    navigate(url)
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-[#ece6ff]" data-testid="lobby">
      <AttractScene cityId={daily.cityId} weather={bgWeather} />

      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-black tracking-tight" style={{ textShadow: '0 0 18px #ff8a1f' }}>CITY CHASE</span>
          <span className="hidden text-xs uppercase tracking-[0.3em] text-white/50 sm:inline">real streets · live weather · cops that learn</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/about" className="text-white/60 hover:text-white">How it works</Link>
          {isSignedIn ? (
            <button onClick={() => void signOut()} className="rounded-full bg-white/10 px-3 py-1.5 backdrop-blur hover:bg-white/20" title="Sign out">
              {user?.firstName ?? 'Signed in'} · sign out
            </button>
          ) : (
            <button onClick={() => setSignIn(true)} className="rounded-full bg-white/10 px-3 py-1.5 backdrop-blur hover:bg-white/20" data-testid="lobby-sign-in">
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="grid gap-5 px-5 pb-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Today's heist */}
          <section className="max-w-xl rounded-2xl border border-orange-400/30 bg-black/45 p-6 backdrop-blur-md">
            <p className="text-xs uppercase tracking-[0.3em] text-orange-300">Today's heist · same city for everyone</p>
            <h1 className="mt-2 text-4xl font-black leading-tight sm:text-5xl" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>
              {dailyCity.name}, {dailyCity.city}
            </h1>
            <p className="mt-2 text-sm text-white/70">
              Grab the loot, reach the safehouse, stay out of the headlights. Real streets from OpenStreetMap; the city's live weather changes the rules.
            </p>
            {dailyWeather && (
              <div className="mt-3">
                <p className="text-sm text-white/80">{weatherLabel(dailyCity.city, dailyCity.timezone, dailyWeather)}</p>
                <RuleBadges weather={dailyWeather} />
              </div>
            )}
            <button
              onClick={() => go('/play')}
              data-testid="play-daily"
              className="mt-5 rounded-xl bg-orange-500 px-8 py-4 text-lg font-black text-black shadow-[0_0_32px_rgba(255,138,31,0.7)] transition hover:scale-[1.02] hover:bg-orange-400"
            >
              ▶ PLAY TODAY'S HEIST
            </button>
            <p className="mt-2 text-xs text-white/50">No sign-in needed to play. Sign in after a run to save your score.</p>
          </section>

          {/* Free play */}
          <section className="max-w-3xl rounded-2xl border border-cyan-400/25 bg-black/45 p-6 backdrop-blur-md" data-testid="free-play">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">Free play</h2>
              <p className="text-xs text-white/50">{CITY_MAZES.length} cities · pick any weather</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {CITY_MAZES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCityId(c.id)}
                  data-testid={`city-${c.id}`}
                  className={`rounded-lg border px-3 py-2 text-left transition ${cityId === c.id ? 'border-cyan-300 bg-cyan-400/20 shadow-[0_0_14px_rgba(55,245,255,0.4)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <span className="block text-sm font-semibold">{c.city}</span>
                  <span className="block text-xs text-white/50">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {WEATHER_PRESETS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWeather(w)}
                  data-testid={`weather-${w}`}
                  className={`rounded-full border px-3 py-1 text-sm transition ${weather === w ? 'border-fuchsia-300 bg-fuchsia-400/25' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
                >
                  {WEATHER_LABEL[w]}
                </button>
              ))}
            </div>
            <button
              onClick={() => go(`/play?mode=free&city=${encodeURIComponent(cityId)}&weather=${weather}`)}
              data-testid="play-free"
              className="mt-5 rounded-xl bg-cyan-400 px-6 py-3 font-bold text-black shadow-[0_0_24px_rgba(55,245,255,0.6)] transition hover:scale-[1.02] hover:bg-cyan-300"
            >
              ▶ Drive {getCity(cityId)?.city} · {WEATHER_LABEL[weather]}
            </button>
          </section>
        </div>

        {/* Leaderboards */}
        <aside className="h-fit rounded-2xl border border-white/10 bg-black/50 p-5 backdrop-blur-md">
          <div className="mb-3 flex gap-2 text-sm">
            <button onClick={() => setBoard('daily')} className={`rounded-full px-3 py-1 ${board === 'daily' ? 'bg-white/20' : 'text-white/60'}`}>Today</button>
            <button onClick={() => setBoard('free')} className={`rounded-full px-3 py-1 ${board === 'free' ? 'bg-white/20' : 'text-white/60'}`}>
              {getCity(cityId)?.city} {weatherEmoji({ condition: weather === 'rain' ? 'rain' : weather === 'snow' ? 'snow' : weather === 'fog' ? 'mist' : 'clear', tempC: 18, windSpeed: weather === 'wind' ? 15 : 2, windDeg: 0, isNight: weather === 'night' })}
            </button>
          </div>
          <Leaderboard board={board === 'daily' ? `daily:${daily.date}` : `free:${cityId}:${weather}`} />
          <p className="mt-4 text-xs text-white/40">Every score is verified by replaying the run on the server.</p>
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 overflow-hidden border-t border-red-500/40 bg-black/80 py-2 text-sm backdrop-blur">
        <div className="flex w-max animate-[ticker_40s_linear_infinite] gap-12 whitespace-nowrap pl-4">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i}><span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold">LIVE</span>{t}</span>
          ))}
        </div>
      </div>

      {signIn && !isSignedIn && <AuthOverlay providers={['google', 'github']} onClose={() => setSignIn(false)} />}
    </div>
  )
}
