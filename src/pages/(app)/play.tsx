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
import { buildConfig } from '@/shared/daily'
import { preloadCity } from '@/game/AttractScene'
import { GameCanvas, type GhostRun, type Hud } from '@/game/GameCanvas'
import { HudOverlay } from '@/game/hud/HudOverlay'
import { ResultScreen, type RunStats } from '@/game/hud/ResultScreen'
import { getSfx } from '@/game/sound'
import { useView } from '@/game/useView'
import { RuleBadges } from '@/game/hud/WeatherInfo'
import type { WeatherRecord } from '@/shared/weather'

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
  | { kind: 'playing'; run: Run; ghost: GhostRun | null }
  | { kind: 'result'; run: Run; stats: RunStats; verified: Verified | null; error?: string; ghost: GhostRun | null }
  | { kind: 'error'; message: string }

interface GhostData { name: string; score: number; cityId: string; seed: number; weather: WeatherRecord; plan: CommanderPlan; inputLog: InputLog }

/** The board's best replayable run, or null (no runs yet, or the request failed). */
async function loadGhost(board: string): Promise<GhostRun | null> {
  try {
    const res = await fetch(`/api/ghost?board=${encodeURIComponent(board)}`)
    const body = (await res.json()) as { success?: boolean; data?: GhostData | null }
    const g = body.success ? body.data : null
    if (!g) return null
    return { name: g.name, score: g.score, log: g.inputLog, cfg: buildConfig({ cityId: g.cityId, seed: g.seed, weather: g.weather, plan: g.plan }) }
  } catch {
    return null
  }
}

// Begin fetching the 3D engine + models as soon as this page's code loads.
preloadCity()

export default function PlayPage() {
  const [params] = useSearchParams()
  const { isSignedIn, isLoaded } = useAuth()
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [hud, setHud] = useState<Hud | null>(null)
  const [view] = useView()
  const [showSignIn, setShowSignIn] = useState(false)

  const wantGhost = params.get('ghost') === '1'
  const [noGhost, setNoGhost] = useState(false)
  const runParams = useMemo(() => {
    const mode = params.get('mode') === 'free' ? 'free' : 'daily'
    return mode === 'free'
      ? { mode, cityId: params.get('city') ?? '', weather: params.get('weather') ?? 'live' }
      : { mode }
  }, [params])

  // Free Play: remember this city/weather so the lobby's board tab shows it when you return.
  useEffect(() => {
    if (runParams.mode !== 'free') return
    try { localStorage.setItem('citychase:freeplay', JSON.stringify({ cityId: runParams.cityId, weather: runParams.weather })) } catch { /* storage blocked */ }
  }, [runParams])

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
      const ghost = wantGhost ? await loadGhost(run.board) : null
      setNoGhost(wantGhost && !ghost)
      setPhase({ kind: 'playing', run, ghost })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [isSignedIn, runParams, wantGhost])

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
  const ghost = phase.kind === 'playing' ? phase.ghost : null
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
    setPhase({ kind: 'result', run, stats, verified: null, ghost })
    try {
      const verified = run.ticket && run.guest
        ? await guestSubmit<Verified>({ ticket: run.ticket, inputLog: log, ...run.guest })
        : await callAction<Verified>('submitRun', { runId: run.runId, inputLog: log })
      setPhase({ kind: 'result', run, stats, verified, ghost })
    } catch (e) {
      setPhase({ kind: 'result', run, stats, verified: null, error: (e as Error).message, ghost })
    }
  }, [run, ghost])

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
          ghost={ghost}
        >
          <HudOverlay hud={hud} city={city} weather={run.weather} mode={run.mode} ghostName={ghost?.name} />
          {hud && hud.countdown > 0 && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/45">
              <p className="mb-3 max-w-md text-center text-base italic text-red-300">📻 “{run.plan.taunt}”</p>
              <RuleBadges weather={run.weather} />
              {ghost && <p className="mt-3 rounded-full bg-cyan-400/20 px-4 py-1 text-sm text-cyan-100">👻 Racing {ghost.name}'s ghost · {ghost.score.toLocaleString('en-US')} pts</p>}
              {noGhost && <p className="mt-3 rounded-full bg-white/10 px-4 py-1 text-sm text-white/70">👻 No ghost on this board yet: set the score to beat</p>}
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
            ghost={phase.ghost ? { name: phase.ghost.name, score: phase.ghost.score } : null}
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
