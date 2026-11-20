/**
 * Play a run: Daily heist or Free Play (?mode=free&city=<id>&weather=<preset>).
 *
 * No sign-in needed. Signed-in players: startRun → play → submitRun.
 * Guests: guest ticket → play → see their score → "Sign in to save": the
 * ticket + input log wait in localStorage across the OAuth redirect, then
 * claimRun verifies and saves it. Either way the server replays the run.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { getCity } from '@/cities'
import { MAX_TICKS, type CommanderPlan, type GameState, type InputLog } from '@/engine'
import { callAction, clearPending, guestStart, loadPending, savePending, type PendingClaim } from '@/game/api'
import { buildConfig, shareString, weatherEmoji, weatherLabel } from '@/game/daily'
import { GameCanvas, type Hud } from '@/game/GameCanvas'
import { HudBar } from '@/game/HudBar'
import { Leaderboard, topPercent, useBoard } from '@/game/Leaderboard'
import { getSfx } from '@/game/sound'
import { useView } from '@/game/useView'
import { RuleBadges } from '@/game/WeatherInfo'
import type { WeatherRecord } from '@/game/weather-source'

interface Run {
  runId?: string
  ticket?: string
  mode: 'daily' | 'free'
  board: string
  date: string
  cityId: string
  seed: number
  weather: WeatherRecord
  plan: CommanderPlan
}

interface Verified {
  score: number
  outcome: string
  durationTicks: number
  best: number
  newBest: boolean
  board: string
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'playing'; run: Run }
  | { kind: 'submitting'; run: Run }
  | { kind: 'guestDone'; pending: PendingClaim }
  | { kind: 'claiming'; pending: PendingClaim }
  | { kind: 'done'; cityId: string; weather: WeatherRecord | null; result: Verified }
  | { kind: 'error'; message: string }

const OUTCOME: Record<string, string> = {
  escaped: 'Clean getaway!',
  busted: 'Busted. The cops got you.',
  timeout: 'Out of time. The city locked down.',
}

export default function PlayPage() {
  const [params] = useSearchParams()
  const { isSignedIn, isLoaded } = useAuth()
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [hud, setHud] = useState<Hud | null>(null)
  const [view] = useView()
  const [showSignIn, setShowSignIn] = useState(false)

  const runParams = useMemo(() => {
    const mode = params.get('mode') === 'free' ? 'free' : 'daily'
    return mode === 'free'
      ? { mode, cityId: params.get('city') ?? '', weather: params.get('weather') ?? 'live' }
      : { mode }
  }, [params])

  const start = useCallback(async () => {
    getSfx()?.resume() // inside the click when this is "Play again"
    setPhase({ kind: 'starting' })
    setHud(null)
    try {
      const run = isSignedIn
        ? await callAction<Run>('startRun', runParams)
        : await guestStart<Run>(runParams)
      setPhase({ kind: 'playing', run })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [isSignedIn, runParams])

  const claim = useCallback(async (pending: PendingClaim) => {
    setPhase({ kind: 'claiming', pending })
    try {
      const result = await callAction<Verified>('claimRun', { ticket: pending.ticket, inputLog: pending.inputLog })
      clearPending()
      setPhase({ kind: 'done', cityId: pending.cityId, weather: null, result })
    } catch (e) {
      clearPending()
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [])

  // On arrival: a guest run waiting for sign-in takes priority; otherwise start a run.
  const booted = useRef(false)
  useEffect(() => {
    if (!isLoaded || booted.current) return
    booted.current = true
    const pending = loadPending()
    if (pending) {
      if (isSignedIn) void claim(pending)
      else setPhase({ kind: 'guestDone', pending })
      return
    }
    void start()
  }, [isLoaded, isSignedIn, claim, start])

  // Signed in from the "save" prompt without a page reload: claim right away.
  useEffect(() => {
    if (isSignedIn && phase.kind === 'guestDone') { setShowSignIn(false); void claim(phase.pending) }
  }, [isSignedIn, phase, claim])

  const run = phase.kind === 'playing' || phase.kind === 'submitting' ? phase.run : undefined
  const city = run ? getCity(run.cityId) : undefined
  const cfg = useMemo(
    () => (run ? buildConfig({ cityId: run.cityId, seed: run.seed, weather: run.weather, plan: run.plan }) : null),
    [run],
  )

  const onEnd = useCallback(async (log: InputLog, final: GameState) => {
    if (!run) return
    if (run.ticket) {
      const pending: PendingClaim = {
        ticket: run.ticket, inputLog: log, localScore: final.score, outcome: final.status,
        cityId: run.cityId, board: run.board, savedAtMs: Date.now(),
      }
      savePending(pending)
      setPhase({ kind: 'guestDone', pending })
      return
    }
    setPhase({ kind: 'submitting', run })
    try {
      const result = await callAction<Verified>('submitRun', { runId: run.runId, inputLog: log })
      setPhase({ kind: 'done', cityId: run.cityId, weather: run.weather, result })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [run])

  return (
    <div className="min-h-full px-3 py-4 text-[#e8e0ff]" style={{ background: '#07030f' }}>
      <div className="mx-auto max-w-6xl">
        {city && run && (
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm" data-testid="hud">
            <span className="opacity-80">
              {run.mode === 'daily' ? "Today's heist · " : 'Free play · '}{weatherLabel(city.city, city.timezone, run.weather)}
            </span>
            {hud && <HudBar hud={hud} />}
          </div>
        )}

        {phase.kind === 'starting' && <Centered><p className="opacity-70">Briefing the crew…</p></Centered>}

        {cfg && run && (phase.kind === 'playing' || phase.kind === 'submitting') && (
          <div className="relative">
            <GameCanvas
              cfg={cfg}
              view={view}
              weather={run.weather}
              maxTicks={MAX_TICKS}
              onHud={setHud}
              onEnd={onEnd}
              onRestart={start}
              onQuit={() => { window.location.href = '/' }}
            />
            {hud && hud.countdown > 0 && (
              <Overlay>
                <p className="mb-2 max-w-sm text-center text-sm italic text-red-300">📻 “{run.plan.taunt}”</p>
                <RuleBadges weather={run.weather} />
                <p className="mt-2 text-6xl font-black" style={{ textShadow: '0 0 20px #37f5ff' }}>{hud.countdown}</p>
              </Overlay>
            )}
            {phase.kind === 'submitting' && <Overlay><p>Verifying your run on the server…</p></Overlay>}
          </div>
        )}

        {phase.kind === 'guestDone' && (
          <div className="mx-auto max-w-md py-10 text-center" data-testid="guest-result">
            <p className="text-sm uppercase tracking-widest opacity-60">{OUTCOME[phase.pending.outcome] ?? phase.pending.outcome}</p>
            <p className="mt-2 text-5xl font-black" style={{ textShadow: '0 0 20px #37f5ff' }}>
              {phase.pending.localScore.toLocaleString('en-US')}
            </p>
            <p className="mt-1 text-xs opacity-60">not saved yet</p>
            <div className="mt-6 rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-5">
              <p className="font-semibold">Save this run to the leaderboard</p>
              <p className="mt-1 text-sm opacity-70">Sign in and we'll verify it by replaying it on the server. Takes a few seconds.</p>
              <button
                onClick={() => setShowSignIn(true)}
                data-testid="save-run"
                className="mt-4 w-full rounded-lg bg-cyan-400 px-5 py-2.5 font-bold text-black shadow-[0_0_18px_#37f5ff] hover:bg-cyan-300"
              >
                Continue with Google or GitHub
              </button>
              <p className="mt-2 text-xs opacity-50">First time? This creates your account. No password needed.</p>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => { clearPending(); void start() }} className="rounded-lg border border-white/30 px-5 py-2.5">Play again</button>
              <Link to="/" onClick={() => clearPending()} className="rounded-lg border border-white/30 px-5 py-2.5">Home</Link>
            </div>
          </div>
        )}

        {phase.kind === 'claiming' && <Centered><p className="opacity-70">Verifying your run on the server…</p></Centered>}

        {phase.kind === 'done' && (
          <Result cityId={phase.cityId} weather={phase.weather} result={phase.result} onAgain={start} />
        )}

        {phase.kind === 'error' && (
          <Centered>
            <p className="mb-4 text-red-300" data-testid="run-error">{phase.message}</p>
            <button onClick={start} className="rounded-lg bg-cyan-400 px-5 py-2.5 font-bold text-black">Try again</button>
          </Centered>
        )}
      </div>
      {showSignIn && <AuthOverlay providers={['google', 'github']} onClose={() => setShowSignIn(false)} />}
    </div>
  )
}

function Result({ cityId, weather, result, onAgain }: {
  cityId: string; weather: WeatherRecord | null; result: Verified; onAgain: () => void
}) {
  const city = getCity(cityId)
  const { records } = useBoard(result.board)
  const pct = topPercent(records.map((r) => r.data.score), result.best)
  const share = shareString({ city: city?.city ?? cityId, weatherEmoji: weather ? weatherEmoji(weather) : '🏙️', score: result.best, topPercent: pct })
  const [copied, setCopied] = useState(false)

  return (
    <div className="mx-auto max-w-md py-6 text-center">
      <p className="text-sm uppercase tracking-widest opacity-60">{OUTCOME[result.outcome] ?? result.outcome}</p>
      <p className="mt-2 text-5xl font-black" data-testid="verified-score" style={{ textShadow: '0 0 20px #37f5ff' }}>
        {result.score.toLocaleString('en-US')}
      </p>
      <p className="mt-1 text-xs opacity-60">verified by server replay · {Math.round(result.durationTicks / 20)}s</p>
      {result.newBest && <p className="mt-2 text-fuchsia-300">New personal best on this board!</p>}
      <div className="mt-6 rounded-lg bg-white/5 p-3 font-mono text-sm" data-testid="share-string">{share}</div>
      <div className="mt-3 flex justify-center gap-3">
        <button className="rounded-lg border border-white/30 px-5 py-2.5" onClick={() => { void navigator.clipboard?.writeText(share); setCopied(true) }}>
          {copied ? 'Copied' : 'Copy result'}
        </button>
        <button onClick={onAgain} className="rounded-lg bg-cyan-400 px-5 py-2.5 font-bold text-black" data-testid="play-again">Play again</button>
      </div>
      <h2 className="mb-3 mt-8 text-left text-lg font-semibold">Leaderboard</h2>
      <div className="text-left"><Leaderboard board={result.board} /></div>
      <Link to="/" className="mt-6 inline-block text-sm underline opacity-70">Back to the lobby</Link>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">{children}</div>
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/40">
      {children}
    </div>
  )
}
