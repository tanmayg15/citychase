/**
 * Play the Daily City. Flow: startRun (server) → play locally → submitRun with
 * the input log → server replays and returns the verified score.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCity } from '@/cities'
import { MAX_TICKS, type CommanderPlan, type GameState, type InputLog } from '@/engine'
import { callAction } from '@/game/api'
import { buildConfig, shareString, weatherEmoji, weatherLabel } from '@/game/daily'
import { GameCanvas, type Hud } from '@/game/GameCanvas'
import { HudBar } from '@/game/HudBar'
import { useView } from '@/game/useView'
import { Leaderboard, topPercent, useDailyBoard } from '@/game/Leaderboard'
import { RuleBadges } from '@/game/WeatherInfo'
import type { WeatherRecord } from '@/game/weather-source'

interface StartedRun {
  runId: string
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
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'playing'; run: StartedRun }
  | { kind: 'submitting'; run: StartedRun; localScore: number }
  | { kind: 'done'; run: StartedRun; result: Verified; localScore: number }
  | { kind: 'error'; message: string; run?: StartedRun }

export default function PlayPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [hud, setHud] = useState<Hud | null>(null)
  const [view, setView] = useView()

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' })
    try {
      const run = await callAction<StartedRun>('startRun')
      setHud(null)
      setPhase({ kind: 'playing', run })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }, [])

  const run = 'run' in phase ? phase.run : undefined
  const city = run ? getCity(run.cityId) : undefined
  const cfg = useMemo(
    () => (run ? buildConfig({ cityId: run.cityId, seed: run.seed, weather: run.weather, plan: run.plan }) : null),
    [run],
  )

  const onEnd = useCallback(async (log: InputLog, final: GameState) => {
    if (!run) return
    setPhase({ kind: 'submitting', run, localScore: final.score })
    try {
      const result = await callAction<Verified>('submitRun', { runId: run.runId, inputLog: log })
      setPhase({ kind: 'done', run, result, localScore: final.score })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message, run })
    }
  }, [run])

  return (
    <div className="min-h-full px-3 py-4 text-[#e8e0ff]" style={{ background: '#07030f' }}>
      <div className="mx-auto max-w-6xl">
        {city && run && (
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm" data-testid="hud">
            <span className="opacity-80">{weatherLabel(city.city, city.timezone, run.weather)}</span>
            {hud && <HudBar hud={hud} />}
          </div>
        )}

        {phase.kind === 'idle' && (
          <Centered>
            <p className="mb-2 opacity-80">Grab loot, reach the safehouse, stay out of the headlights.</p>
            <p className="mb-4 text-xs opacity-50">Your run is scored by replaying it on the server.</p>
            <Button onClick={start} testId="start-run">Start run</Button>
            <button onClick={() => setView(view === '3d' ? '2d' : '3d')} className="mt-3 text-xs underline opacity-60" data-testid="view-toggle">
              Graphics: {view === '3d' ? '3D (switch to 2D)' : '2D (switch to 3D)'}
            </button>
          </Centered>
        )}
        {phase.kind === 'starting' && <Centered><p className="opacity-70">Getting today's city…</p></Centered>}

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
              onQuit={() => setPhase({ kind: 'idle' })}
            />
            {hud && hud.countdown > 0 && (
              <Overlay>
                <p className="mb-2 max-w-sm text-center text-sm italic text-red-300">📻 “{run.plan.taunt}”</p>
                <RuleBadges weather={run.weather} />
                <p className="text-6xl font-black" style={{ textShadow: '0 0 20px #37f5ff' }}>{hud.countdown}</p>
              </Overlay>
            )}
            {phase.kind === 'submitting' && <Overlay><p>Verifying your run on the server…</p></Overlay>}
          </div>
        )}

        {phase.kind === 'done' && city && (
          <Result
            date={phase.run.date}
            cityName={city.city}
            emoji={weatherEmoji(phase.run.weather)}
            result={phase.result}
            onAgain={start}
          />
        )}

        {phase.kind === 'error' && (
          <Centered>
            <p className="mb-4 text-red-300" data-testid="run-error">{phase.message}</p>
            <Button onClick={start}>Try again</Button>
          </Centered>
        )}
      </div>
    </div>
  )
}

function Result({ date, cityName, emoji, result, onAgain }: {
  date: string; cityName: string; emoji: string; result: Verified; onAgain: () => void
}) {
  const { records } = useDailyBoard(date)
  const pct = topPercent(records.map((r) => r.data.score), result.best)
  const share = shareString({ city: cityName, weatherEmoji: emoji, score: result.best, topPercent: pct })
  const [copied, setCopied] = useState(false)
  const outcome = {
    escaped: 'Clean getaway!',
    busted: 'Busted. The cops got you.',
    timeout: 'Out of time. The city locked down.',
  }[result.outcome] ?? result.outcome

  return (
    <div className="mx-auto max-w-md py-6 text-center">
      <p className="text-sm uppercase tracking-widest opacity-60">{outcome}</p>
      <p className="mt-2 text-5xl font-black" data-testid="verified-score" style={{ textShadow: '0 0 20px #37f5ff' }}>
        {result.score.toLocaleString('en-US')}
      </p>
      <p className="mt-1 text-xs opacity-60">verified by server replay · {Math.round(result.durationTicks / 20)}s</p>
      {result.newBest && <p className="mt-2 text-fuchsia-300">New personal best today!</p>}

      <div className="mt-6 rounded-lg bg-white/5 p-3 font-mono text-sm" data-testid="share-string">{share}</div>
      <div className="mt-3 flex justify-center gap-3">
        <Button onClick={() => { void navigator.clipboard?.writeText(share); setCopied(true) }}>
          {copied ? 'Copied' : 'Copy result'}
        </Button>
        <Button onClick={onAgain} testId="play-again">Play again</Button>
      </div>

      <h2 className="mb-3 mt-8 text-left text-lg font-semibold">Today's leaderboard</h2>
      <div className="text-left"><Leaderboard date={date} /></div>
      <Link to="/home" className="mt-6 inline-block text-sm underline opacity-70">Back to today's city</Link>
    </div>
  )
}

function Button({ onClick, children, testId }: { onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="rounded-lg bg-cyan-400 px-5 py-2.5 font-bold text-black shadow-[0_0_18px_#37f5ff] hover:bg-cyan-300"
    >
      {children}
    </button>
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
