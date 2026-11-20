/**
 * End-of-run screen: the run's city keeps playing in 3D behind a headline,
 * an animated score, stat tiles and the leaderboard. Used for both signed-in
 * and guest runs (guests see "on the board as Guest 1234 · sign in to keep it").
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCity } from '../cities'
import { AttractScene } from './AttractScene'
import { shareString, weatherEmoji } from './daily'
import { Leaderboard, topPercent, useBoard } from './Leaderboard'
import type { WeatherRecord } from './weather-source'

export interface RunStats {
  outcome: string
  score: number
  lootTaken: number
  lootTotal: number
  seconds: number
  heatSeconds: number
  livesLeft: number
}

const HEADLINE: Record<string, { title: string; sub: string; color: string }> = {
  escaped: { title: 'CLEAN GETAWAY', sub: 'You made it to the safehouse.', color: '#3dff9a' },
  busted: { title: 'BUSTED', sub: 'The cops boxed you in.', color: '#ff4a5a' },
  timeout: { title: 'OUT OF TIME', sub: 'The city locked down before you got out.', color: '#ffb020' },
}

function useCountUp(target: number, ms = 1200): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export function ResultScreen({
  cityId, weather, board, stats, verified, newBest, guestName, onAgain, onSignIn, error,
}: {
  cityId: string
  weather: WeatherRecord
  board: string
  stats: RunStats
  /** null while the server is still verifying */
  verified: boolean | null
  newBest?: boolean
  guestName?: string
  onAgain: () => void
  onSignIn?: () => void
  error?: string
}) {
  const city = getCity(cityId)
  const head = HEADLINE[stats.outcome] ?? HEADLINE.timeout
  const shown = useCountUp(stats.score)
  const { records } = useBoard(board)
  const pct = topPercent(records.map((r) => r.data.score), stats.score)
  const share = shareString({ city: city?.city ?? cityId, weatherEmoji: weatherEmoji(weather), score: stats.score, topPercent: pct })
  const [copied, setCopied] = useState(false)

  const tiles = [
    { label: 'Loot', value: `${stats.lootTaken}/${stats.lootTotal}`, icon: '◆' },
    { label: 'Time', value: `${Math.floor(stats.seconds / 60)}:${String(stats.seconds % 60).padStart(2, '0')}`, icon: '⏱' },
    { label: 'Seen by cops', value: `${stats.heatSeconds}s`, icon: '🚨' },
    { label: 'Cars left', value: `${stats.livesLeft}`, icon: '🚗' },
  ]

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center px-4 py-8 text-white" data-testid="result-screen">
      <AttractScene cityId={cityId} weather={weather} />
      <Link to="/" className="absolute left-4 top-4 rounded-full bg-black/50 px-4 py-2 text-sm text-white/80 backdrop-blur hover:bg-black/70 hover:text-white">← Lobby</Link>
      <div className="grid w-full max-w-5xl items-start gap-5 lg:grid-cols-[1fr_340px]">
        <section className="rounded-3xl border border-white/15 bg-black/55 p-7 text-center shadow-2xl backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.35em] text-white/60">{city?.name}, {city?.city}</p>
          <h1 className="mt-2 text-5xl font-black tracking-tight sm:text-6xl" style={{ color: head.color, textShadow: `0 0 30px ${head.color}88` }}>
            {head.title}
          </h1>
          <p className="mt-1 text-white/70">{head.sub}</p>

          <p className="mt-6 font-mono text-7xl font-black tabular-nums" data-testid="verified-score" style={{ textShadow: '0 0 30px rgba(255,138,31,0.6)' }}>
            {shown.toLocaleString('en-US')}
          </p>
          <p className="mt-1 text-xs text-white/50">
            {verified === null ? 'Verifying on the server…' : verified ? 'Verified by server replay' : 'Not verified'}
            {newBest && verified ? ' · new personal best!' : ''}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-xl">{t.icon}</p>
                <p className="mt-1 font-mono text-xl font-bold">{t.value}</p>
                <p className="text-[11px] uppercase tracking-wider text-white/50">{t.label}</p>
              </div>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-red-300" data-testid="run-error">{error}</p>}

          {guestName && verified && (
            <div className="mt-5 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm" data-testid="guest-note">
              You're on the board as <strong>{guestName}</strong>.{' '}
              {onSignIn && (
                <button onClick={onSignIn} className="font-semibold text-cyan-300 underline underline-offset-4" data-testid="keep-scores">
                  Sign in to keep your scores
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={onAgain} data-testid="play-again"
              className="rounded-xl bg-orange-500 px-7 py-3 font-black text-black shadow-[0_0_28px_rgba(255,138,31,0.6)] hover:bg-orange-400">
              ▶ Play again
            </button>
            <button onClick={() => { void navigator.clipboard?.writeText(share); setCopied(true) }}
              className="rounded-xl border border-white/25 bg-white/5 px-5 py-3 hover:bg-white/10">
              {copied ? 'Copied!' : 'Share result'}
            </button>
            <Link to="/" data-testid="result-home" className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/5 px-5 py-3 hover:bg-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
              Home
            </Link>
          </div>
        </section>

        <aside className="rounded-3xl border border-white/15 bg-black/55 p-5 backdrop-blur-md">
          <p className="mb-3 text-sm font-semibold">Leaderboard {pct !== null && verified && records.length > 1 ? <span className="text-white/50">· you're top {pct}%</span> : null}</p>
          <Leaderboard board={board} limit={8} />
        </aside>
      </div>
    </div>
  )
}
