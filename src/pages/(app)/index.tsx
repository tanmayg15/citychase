/**
 * The lobby: the one home page, fitted to a single screen (no scrolling on
 * desktop). A live 3D city (bot-played demo) behind: Today's heist, Free Play
 * (any city, any weather) and the leaderboard. Playing never requires sign-in.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuth, useAuthUser, useQuery } from 'deepspace'
import { CITY_MAZES, getCity } from '@/cities'
import { callAction, claimGuestIfAny, loadGuest } from '@/game/api'
import { AttractScene } from '@/game/AttractScene'
import { dailyFor, utcDate, weatherLabel } from '@/game/daily'
import { Leaderboard } from '@/game/Leaderboard'
import { getSfx } from '@/game/sound'
import { RuleBadges } from '@/game/WeatherInfo'
import { WEATHER_PRESETS, type WeatherPreset, type WeatherRecord } from '@/game/weather-source'

const WEATHER_LABEL: Record<WeatherPreset, string> = {
  live: '📡 Live', clear: '☀️ Clear', rain: '🌧️ Rain', snow: '❄️ Snow', wind: '💨 Wind', heat: '🔥 Heat', night: '🌙 Night', fog: '🌫️ Fog',
}

const TICKER = [
  'BREAKING: Getaway car spotted near the waterfront, units en route',
  'Police chief: "Every unit has eyes on the main avenues tonight"',
  'Weather desk: rain makes roads slick, drivers slide on turns',
  'Smoke-bomb sightings up 300% this week, say officials',
  'Safehouse locations change daily, say anonymous sources',
]

const panel = 'rounded-2xl border border-white/10 bg-black/50 backdrop-blur-md'

export default function Lobby() {
  const navigate = useNavigate()
  const { isSignedIn } = useAuth()
  const { user } = useAuthUser()
  const [signIn, setSignIn] = useState(false)
  const daily = dailyFor(utcDate())
  const dailyCity = getCity(daily.cityId)!
  const [cityId, setCityId] = useState(CITY_MAZES[0].id)
  const [weather, setWeather] = useState<WeatherPreset>('live')
  const [board, setBoard] = useState<'alltime' | 'daily' | 'free'>('alltime')
  const [guestName, setGuestName] = useState<string | null>(null)
  useEffect(() => setGuestName(loadGuest()?.guestName ?? null), [])

  const { records } = useQuery<{ cityId: string; weather: WeatherRecord }>('weatherCache', { where: { cityId: daily.cityId } })
  const dailyWeather = records[0]?.data.weather
  const bgWeather = useMemo(() => dailyWeather, [dailyWeather?.fetchedAtMs])

  // Back from sign-in: move this browser's guest scores to the account.
  useEffect(() => { if (isSignedIn) void claimGuestIfAny() }, [isSignedIn])

  // Real headlines about today's city (NewsAPI, cached on the server); falls back to the canned ticker.
  const [news, setNews] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/news').then((r) => r.json() as Promise<{ data?: { headlines?: string[] } }>)
      .then((b) => setNews(b.data?.headlines ?? [])).catch(() => {})
  }, [])

  // Opt-in email alert when someone takes your #1 spot.
  const [alerts, setAlerts] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isSignedIn) return
    callAction<{ emailAlerts: boolean }>('getPrefs').then((p) => setAlerts(p.emailAlerts)).catch(() => {})
  }, [isSignedIn])
  const toggleAlerts = () => {
    const next = !alerts
    setAlerts(next)
    callAction('setAlerts', { enabled: next }).catch(() => setAlerts(!next))
  }

  const go = (url: string) => {
    getSfx()?.resume() // unlock audio inside the click
    navigate(url)
  }
  const pick = getCity(cityId)!

  return (
    <div className="relative isolate flex h-screen flex-col overflow-hidden text-[#ece6ff]" data-testid="lobby">
      <AttractScene cityId={daily.cityId} weather={bgWeather} />

      <header className="flex shrink-0 items-center justify-between px-5 py-3 sm:px-8">
        <span className="text-2xl font-black tracking-tight" style={{ textShadow: '0 0 18px #ff8a1f' }}>CITY CHASE</span>
        {isSignedIn ? (
          <div className="flex items-center gap-2">
            {alerts !== null && (
              <button onClick={toggleAlerts} data-testid="alerts-toggle"
                className={`rounded-full px-3 py-1.5 text-sm backdrop-blur ${alerts ? 'bg-amber-400/25 text-amber-100' : 'bg-white/10 text-white/70'}`}
                title="Email me if someone takes my #1 spot">
                {alerts ? '🔔 #1 alerts on' : '🔕 #1 alerts off'}
              </button>
            )}
            <button onClick={() => void signOut()} className="rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur hover:bg-white/20" title="Sign out">
              {user?.firstName ?? 'Signed in'} · sign out
            </button>
          </div>
        ) : (
          <button onClick={() => setSignIn(true)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur hover:bg-white/20" data-testid="lobby-sign-in">
            {guestName ? `${guestName} · sign in` : 'Sign in'}
          </button>
        )}
      </header>

      <main className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
        <div className="flex min-h-0 flex-col gap-4">
          {/* Today's heist */}
          <section className="shrink-0 rounded-2xl border border-orange-400/30 bg-black/50 p-5 backdrop-blur-md">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-orange-300">Today's heist · same city for everyone</p>
                <h1 className="mt-1 text-3xl font-black leading-tight sm:text-4xl" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>
                  {dailyCity.name}, {dailyCity.city}
                </h1>
                {dailyWeather && (
                  <div className="mt-1">
                    <p className="text-sm text-white/75">{weatherLabel(dailyCity.city, dailyCity.timezone, dailyWeather).replace(' (mock)', '')}</p>
                    <RuleBadges weather={dailyWeather} />
                  </div>
                )}
              </div>
              <button
                onClick={() => go('/play')}
                data-testid="play-daily"
                className="rounded-xl bg-orange-500 px-7 py-3.5 text-lg font-black text-black shadow-[0_0_32px_rgba(255,138,31,0.7)] transition hover:scale-[1.03] hover:bg-orange-400"
              >
                ▶ PLAY TODAY'S HEIST
              </button>
            </div>
          </section>

          {/* Free play */}
          <section className={`${panel} flex flex-col border-cyan-400/25 p-5`} data-testid="free-play">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">Free play</h2>
              <p className="text-xs text-white/50">{CITY_MAZES.length} real cities · any weather</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5">
              {CITY_MAZES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCityId(c.id)}
                  data-testid={`city-${c.id}`}
                  title={`${c.name}, ${c.city}`}
                  className={`truncate rounded-lg border px-2.5 py-1.5 text-left text-sm transition ${cityId === c.id ? 'border-cyan-300 bg-cyan-400/20 shadow-[0_0_14px_rgba(55,245,255,0.4)]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <span className="font-semibold">{c.city}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
              <button
                onClick={() => go(`/play?mode=free&city=${encodeURIComponent(cityId)}&weather=${weather}`)}
                data-testid="play-free"
                className="group ml-auto flex items-center gap-3 rounded-xl border border-cyan-300/70 bg-gradient-to-r from-cyan-500/25 to-sky-600/25 px-4 py-2 text-left shadow-[0_0_22px_rgba(55,245,255,0.35)] transition hover:scale-[1.03] hover:border-cyan-200 hover:shadow-[0_0_30px_rgba(55,245,255,0.6)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-300 text-sm text-black shadow-[0_0_14px_#37f5ff]">▶</span>
                <span className="leading-tight">
                  <span className="block text-sm font-black tracking-wider text-cyan-100">DRIVE</span>
                  <span className="block text-xs text-white/70">{pick.city} · {pick.name} · {WEATHER_LABEL[weather]}</span>
                </span>
              </button>
            </div>
          </section>
        </div>

        {/* Leaderboard */}
        <aside className={`${panel} flex h-fit max-h-full min-h-0 flex-col p-5`}>
          <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Leaderboard</p>
          <div className="mb-3 flex gap-1.5 text-sm">
            <button onClick={() => setBoard('alltime')} data-testid="board-alltime" className={`rounded-full px-3 py-1 ${board === 'alltime' ? 'bg-white/20' : 'text-white/60'}`}>All-time</button>
            <button onClick={() => setBoard('daily')} className={`rounded-full px-3 py-1 ${board === 'daily' ? 'bg-white/20' : 'text-white/60'}`}>Today</button>
            <button onClick={() => setBoard('free')} className={`truncate rounded-full px-3 py-1 ${board === 'free' ? 'bg-white/20' : 'text-white/60'}`}>
              {pick.city} · {WEATHER_LABEL[weather]}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Leaderboard board={board === 'alltime' ? 'alltime' : board === 'daily' ? `daily:${daily.date}` : `free:${cityId}:${weather}`} limit={10} />
          </div>
        </aside>
      </main>

      <div className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-red-500/40 bg-black/80 py-2 text-sm backdrop-blur">
        <div className="flex w-max animate-[ticker_40s_linear_infinite] gap-12 whitespace-nowrap pl-4">
          {(() => {
            const items = news.length ? news.map((h) => ({ tag: dailyCity.city.toUpperCase(), text: h })) : TICKER.map((t) => ({ tag: 'LIVE', text: t }))
            return [...items, ...items].map((t, i) => (
              <span key={i}><span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold">{t.tag}</span>{t.text}</span>
            ))
          })()}
        </div>
      </div>

      {signIn && !isSignedIn && <AuthOverlay providers={['google', 'github']} onClose={() => setSignIn(false)} />}
    </div>
  )
}
