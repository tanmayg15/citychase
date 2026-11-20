/**
 * Play a run, full screen: Daily heist or Free Play (?mode=free&city=<id>&weather=<preset>).
 *
 * No sign-in needed:
 *  - signed in: startRun → play → submitRun
 *  - guest:     guest ticket → play → guest submit (on the board as "Guest 1234")
 * Either way the server replays the run before any score is stored. A guest
 * who signs in later gets their scores moved to the account (claimGuest).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { getCity } from '@/cities'
import { MAX_TICKS, TICK_RATE, type CommanderPlan, type GameState, type InputLog } from '@/engine'
import { callAction, claimGuestIfAny, guestStart, guestSubmit, loadGuest, saveGuest, type Guest } from '@/game/api'
import { buildConfig } from '@/game/daily'
import { GameCanvas, type Hud } from '@/game/GameCanvas'
import { HudOverlay } from '@/game/HudOverlay'
import { ResultScreen, type RunStats } from '@/game/ResultScreen'
import { getSfx } from '@/game/sound'
import { useView } from '@/game/useView'
import { RuleBadges } from '@/game/WeatherInfo'
import type { WeatherRecord } from '@/game/weather-source'

interface Run {
  runId?: string
  ticket?: string
  guest?: Guest
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
  newBest: boolean
  board: string
  guestName?: string
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'playing'; run: Run }
  | { kind: 'result'; run: Run; stats: RunStats; verified: Verified | null; error?: string }
  | { kind: 'error'; message: string }

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
      let run: Run
      if (isSignedIn) {
        run = await callAction<Run>('startRun', runParams)
      } else {
        const g = loadGuest()
        run = await guestStart<Run>({ ...runParams, guestId: g?.guestId, guestToken: g?.guestToken })
        if (run.guest) saveGuest(run.guest)
      }
      setPhase({ kind: 'playing', run })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [isSignedIn, runParams])

  // Start once auth is known. If the visitor just signed in, move their guest scores first.
  const booted = useRef(false)
  useEffect(() => {
    if (!isLoaded || booted.current) return
    booted.current = true
    void (async () => {
      if (isSignedIn) await claimGuestIfAny()
      await start()
    })()
  }, [isLoaded, isSignedIn, start])

  // Signed in from the result screen: move the guest scores now.
  useEffect(() => {
    if (isSignedIn && showSignIn) { setShowSignIn(false); void claimGuestIfAny() }
  }, [isSignedIn, showSignIn])

  const run = phase.kind === 'playing' ? phase.run : undefined
  const city = run ? getCity(run.cityId) : undefined
  const cfg = useMemo(
    () => (run ? buildConfig({ cityId: run.cityId, seed: run.seed, weather: run.weather, plan: run.plan }) : null),
    [run],
  )

  const onEnd = useCallback(async (log: InputLog, final: GameState) => {
    if (!run) return
    const stats: RunStats = {
      outcome: final.status, score: final.score, lootTaken: final.lootTaken, lootTotal: final.loot.length,
      seconds: Math.round(final.tick / TICK_RATE), heatSeconds: Math.round(final.heat / TICK_RATE), livesLeft: final.lives,
    }
    setPhase({ kind: 'result', run, stats, verified: null })
    try {
      const verified = run.ticket && run.guest
        ? await guestSubmit<Verified>({ ticket: run.ticket, inputLog: log, ...run.guest })
        : await callAction<Verified>('submitRun', { runId: run.runId, inputLog: log })
      setPhase({ kind: 'result', run, stats, verified })
    } catch (e) {
      setPhase({ kind: 'result', run, stats, verified: null, error: (e as Error).message })
    }
  }, [run])

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#07030f] text-white">
      {phase.kind === 'starting' && (
        <div className="flex h-full items-center justify-center text-white/70">Briefing the crew…</div>
      )}

      {cfg && run && city && phase.kind === 'playing' && (
        <GameCanvas
          fill
          cfg={cfg}
          view={view}
          weather={run.weather}
          maxTicks={MAX_TICKS}
          onHud={setHud}
          onEnd={onEnd}
          onRestart={start}
          onQuit={() => { window.location.href = '/' }}
        >
          <HudOverlay hud={hud} city={city} weather={run.weather} mode={run.mode} />
          {hud && hud.countdown > 0 && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/45">
              <p className="mb-3 max-w-md text-center text-base italic text-red-300">📻 “{run.plan.taunt}”</p>
              <RuleBadges weather={run.weather} />
              <p className="mt-3 text-8xl font-black" style={{ textShadow: '0 0 30px #ff8a1f' }}>{hud.countdown}</p>
            </div>
          )}
        </GameCanvas>
      )}

      {phase.kind === 'result' && (
        <div className="h-full overflow-y-auto">
          <ResultScreen
            cityId={phase.run.cityId}
            weather={phase.run.weather}
            board={phase.run.board}
            stats={phase.stats}
            verified={phase.error ? false : phase.verified ? true : null}
            newBest={phase.verified?.newBest}
            guestName={phase.verified?.guestName}
            onAgain={start}
            onSignIn={isSignedIn ? undefined : () => setShowSignIn(true)}
            error={phase.error}
          />
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="text-red-300" data-testid="run-error">{phase.message}</p>
          <button onClick={start} className="rounded-lg bg-orange-500 px-5 py-2.5 font-bold text-black">Try again</button>
        </div>
      )}

      {showSignIn && !isSignedIn && <AuthOverlay providers={['google', 'github']} onClose={() => setShowSignIn(false)} />}
    </div>
  )
}
