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
import { AttractScene, preloadCity } from '@/game/AttractScene'
import { dailyFor, utcDate, weatherEmoji, weatherLabel } from '@/shared/daily'
import { Leaderboard, useMyLeaderId, type LeaderRow } from '@/game/hud/Leaderboard'
import { getSfx } from '@/game/sound'
import { RuleBadges } from '@/game/hud/WeatherInfo'
import { WEATHER_PRESETS, mockWeather, type WeatherPreset, type WeatherRecord } from '@/shared/weather'

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

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/85">{children}</kbd>
}

const panel = 'rounded-2xl border border-white/10 bg-black/50 backdrop-blur-md'

// Begin fetching the 3D engine + models as soon as this page's code loads.
preloadCity()

export default function Lobby() {
  const navigate = useNavigate()
  const { isSignedIn } = useAuth()
  const { user } = useAuthUser()
  const [signIn, setSignIn] = useState(false)
  const daily = dailyFor(utcDate())
  const dailyCity = getCity(daily.cityId)!
  const [cityId, setCityId] = useState(CITY_MAZES[0].id)
  const [weather, setWeather] = useState<WeatherPreset>('live')
  // Remember the last Free Play choice so its leaderboard tab matches your last run.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('citychase:freeplay') ?? 'null') as { cityId?: string; weather?: WeatherPreset } | null
      if (saved?.cityId && getCity(saved.cityId)) setCityId(saved.cityId)
      if (saved?.weather && WEATHER_PRESETS.includes(saved.weather)) setWeather(saved.weather)
    } catch { /* storage blocked */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('citychase:freeplay', JSON.stringify({ cityId, weather })) } catch { /* storage blocked */ }
  }, [cityId, weather])
  // Opponent: drive solo, or race the ghost of the board's #1 run.
  const [ghost, setGhost] = useState(false)
  useEffect(() => { try { setGhost(localStorage.getItem('citychase:ghost') === '1') } catch { /* storage blocked */ } }, [])
  const pickGhost = (on: boolean) => {
    setGhost(on)
    try { localStorage.setItem('citychase:ghost', on ? '1' : '0') } catch { /* storage blocked */ }
  }
  const vs = ghost ? 'ghost=1' : ''
  const [board, setBoard] = useState<'alltime' | 'daily' | 'free'>('alltime')
  const [guestName, setGuestName] = useState<string | null>(null)
  useEffect(() => setGuestName(loadGuest()?.guestName ?? null), [])

  // Every city's latest cached live weather; cities without one show their free mock weather,
  // so the weather (the game's core idea) is always visible, even with paid calls off.
  const { records: weatherRows } = useQuery<{ cityId: string; weather: WeatherRecord }>('weatherCache', { limit: 50 })
  const [nowMs] = useState(() => Date.now())
  const weatherOf = useMemo(() => {
    const live = new Map(weatherRows.map((r) => [r.data.cityId, r.data.weather]))
    return (id: string): WeatherRecord => live.get(id) ?? mockWeather(id, getCity(id)?.timezone ?? 'UTC', nowMs)
  }, [weatherRows, nowMs])
  const dailyWeather = weatherOf(daily.cityId)
  const bgWeather = useMemo(() => dailyWeather, [dailyWeather.fetchedAtMs, dailyWeather.cityId])

  // Returning players: their all-time best, shown next to their name.
  const me = useMyLeaderId()
  const { records: mine } = useQuery<LeaderRow>('scores', { where: { board: 'alltime', userId: me ?? '__none__' }, limit: 1 })
  const myBest = me ? mine[0]?.data.score : undefined

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

      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-2xl font-black tracking-tight" style={{ textShadow: '0 0 18px #ff8a1f' }}>CITY CHASE</span>
          <div className="flex rounded-full bg-black/50 p-0.5 text-sm backdrop-blur" role="radiogroup" aria-label="Opponent" title="Race the ghost of the board's #1 run">
            {([[false, '🚗 Solo'], [true, '👻 Race #1 ghost']] as const).map(([on, label]) => (
              <button key={label} role="radio" aria-checked={ghost === on} onClick={() => pickGhost(on)} data-testid={on ? 'opponent-ghost' : 'opponent-solo'}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition ${ghost === on ? (on ? 'bg-cyan-400/40 text-white shadow-[0_0_16px_rgba(55,245,255,0.7)] ring-1 ring-cyan-300' : 'bg-white/20 text-white') : 'text-white/60 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
        {myBest !== undefined && (
          <span className="hidden whitespace-nowrap rounded-full border border-amber-300/40 bg-black/50 px-3 py-1.5 text-sm backdrop-blur xl:inline" data-testid="your-best" title="Your all-time best">
            🏆 Your best <strong className="font-mono">{myBest.toLocaleString('en-US')}</strong>
          </span>
        )}
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
          <button onClick={() => setSignIn(true)} className="whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur hover:bg-white/20" data-testid="lobby-sign-in">
            {guestName ? `${guestName} · sign in` : 'Sign in'}
          </button>
        )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:content-stretch lg:overflow-hidden">
        <div className="flex flex-col justify-between gap-4 lg:min-h-0">
          {/* Today's heist */}
          <section className="shrink-0 rounded-2xl border border-orange-400/30 bg-black/50 p-5 backdrop-blur-md">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-orange-300">Today's heist · same city for everyone</p>
                <h1 className="mt-1 text-3xl font-black leading-tight sm:text-4xl" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>
                  {dailyCity.name}, {dailyCity.city}
                </h1>
                <div className="mt-1" data-testid="daily-weather">
                  <p className="text-sm text-white/75">{weatherLabel(dailyCity.city, dailyCity.timezone, dailyWeather).replace(' (mock)', '')}</p>
                  <RuleBadges weather={dailyWeather} />
                </div>
              </div>
              <button
                onClick={() => go(vs ? `/play?${vs}` : '/play')}
                data-testid="play-daily"
                className="rounded-xl bg-orange-500 px-7 py-3.5 text-lg font-black text-black shadow-[0_0_32px_rgba(255,138,31,0.7)] transition hover:scale-[1.03] hover:bg-orange-400"
              >
                ▶ PLAY TODAY'S HEIST
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 pt-3 text-xs text-white/65" data-testid="controls-strip">
              <span><Key>←↑↓→</Key> / <Key>WASD</Key> / swipe to drive</span>
              <span><Key>1</Key> 🔥 Nitro</span>
              <span><Key>2</Key> 🛢️ Oil</span>
              <span><Key>3</Key> 🎭 Disguise</span>
              <span>💎 grab 7 loot, then reach the <strong className="text-emerald-300">H</strong></span>
            </div>
          </section>

          {/* Free play */}
          <section className={`${panel} flex max-w-3xl flex-col border-cyan-400/25 p-5`} data-testid="free-play">
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
                  <span className="mr-1" aria-hidden>{weatherEmoji(weatherOf(c.id))}</span>
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
            </div>
            <button
              onClick={() => go(`/play?mode=free&city=${encodeURIComponent(cityId)}&weather=${weather}${vs ? `&${vs}` : ''}`)}
              data-testid="play-free"
              className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-500 px-6 py-3.5 text-black shadow-[0_0_28px_rgba(55,245,255,0.5)] transition hover:scale-[1.01] hover:brightness-110"
            >
              <span className="text-lg font-black tracking-wide">▶ DRIVE {pick.city.toUpperCase()}</span>
              <span className="truncate text-sm font-semibold text-black/70">{pick.name} · {WEATHER_LABEL[weather]}</span>
            </button>
          </section>
        </div>

        {/* Leaderboard */}
        <aside className={`${panel} flex h-fit flex-col p-5 lg:max-h-full lg:min-h-0`}>
          <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Leaderboard</p>
          <div className="mb-3 flex flex-wrap gap-1.5 text-sm" role="tablist">
            {([
              ['alltime', 'All-time', 'Best score ever, any city'],
              ['daily', 'Daily', `Today's heist: ${dailyCity.city}`],
              ['free', `${pick.city} ${WEATHER_LABEL[weather].split(' ')[0]}`, `${pick.city} · ${WEATHER_LABEL[weather]}`],
            ] as const).map(([id, label, title]) => (
              <button
                key={id}
                role="tab"
                aria-selected={board === id}
                title={title}
                onClick={() => setBoard(id)}
                data-testid={`board-${id}`}
                className={`whitespace-nowrap rounded-full px-3 py-1 ${board === id ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 lg:min-h-0 lg:overflow-hidden">
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
