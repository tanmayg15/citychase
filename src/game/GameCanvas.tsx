/**
 * Runs one game in the browser: fixed 20 Hz ticks on a requestAnimationFrame
 * loop, keyboard + swipe input, and a recorded input log. The log is exactly
 * what the server replays, so whatever happens here must go through step().
 *
 * Two views over the same game loop:
 *  - '3d': Three.js chase-cam city (loaded on demand) + a 2D minimap
 *  - '2d': the top-down city map only (fallback for weak devices / no WebGL)
 */
import { useEffect, useRef, useState } from 'react'
import {
  CLEAR_WEATHER, Dir, LOOT_TO_OPEN_EXIT, TICK_RATE, createGame, step,
  type GameConfig, type GameState, type InputLog, type WeatherSnapshot,
} from '../engine'
import { Motion } from './motion'
import { getSfx, unlockOnNextGesture, type Sfx } from './sound'
import { drawFrame } from './renderer'
import type { CityScene } from './three/CityScene'

const TICK_MS = 1000 / TICK_RATE
/** Large frame gaps (tab hidden, slow device) slow the game down instead of skipping ticks. */
const MAX_FRAME_MS = 250
const COUNTDOWN_MS = 3000
const MINIMAP_TILE = 6

export type View = '3d' | '2d'

const KEYS: Record<string, Dir> = {
  ArrowUp: Dir.Up, ArrowRight: Dir.Right, ArrowDown: Dir.Down, ArrowLeft: Dir.Left,
  w: Dir.Up, d: Dir.Right, s: Dir.Down, a: Dir.Left,
  W: Dir.Up, D: Dir.Right, S: Dir.Down, A: Dir.Left,
}

export interface Hud {
  score: number
  lives: number
  secondsLeft: number
  status: GameState['status']
  countdown: number
  lootTaken: number
  lootTotal: number
  lootToOpen: number
  exitOpen: boolean
  /** True while at least one cop is chasing you. */
  wanted: boolean
  heat: number
}

/** WebGL available and the device is not obviously too weak for the 3D view. */
export function supports3d(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    if (!gl) return false
    const cores = navigator.hardwareConcurrency ?? 4
    return cores >= 4
  } catch {
    return false
  }
}

type Ui = 'ready' | 'running' | 'paused' | 'ended'

const OUTCOME: Record<string, string> = {
  escaped: 'Clean getaway!',
  busted: 'Busted.',
  timeout: 'Out of time.',
}

export function GameCanvas({
  cfg, maxTicks, onHud, onEnd, view = '3d', weather = CLEAR_WEATHER,
  waitForStart = false, showEndScreen = false, onRestart, onQuit,
}: {
  cfg: GameConfig
  maxTicks: number
  onHud: (h: Hud) => void
  onEnd: (log: InputLog, final: GameState) => void
  view?: View
  weather?: WeatherSnapshot
  /** Show a Start screen first (practice). The daily run already had its Start button. */
  waitForStart?: boolean
  /** Show the outcome + Play again / Quit when the game ends (practice). */
  showEndScreen?: boolean
  onRestart?: () => void
  onQuit?: () => void
}) {
  const [ui, setUi] = useState<Ui>(waitForStart ? 'ready' : 'running')
  const uiRef = useRef<Ui>(ui)
  const setUiBoth = (u: Ui) => { uiRef.current = u; setUi(u) }
  const [final, setFinal] = useState<{ status: string; score: number; loot: number } | null>(null)
  const sfx = useRef<Sfx | null>(null)
  if (!sfx.current) sfx.current = getSfx()
  const [muted, setMuted] = useState(() => sfx.current?.isMuted() ?? false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const nightRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<View>(view)
  const [box, setBox] = useState({ w: 800, h: 520 })
  const boxRef = useRef(box)
  const cb = useRef({ onHud, onEnd })
  cb.current = { onHud, onEnd }

  useEffect(() => setMode(view), [view])
  // Audio is shared across games: unlock it on any gesture, silence it on unmount.
  useEffect(() => {
    sfx.current?.setPaused(false) // a previous game may have been quit while paused
    if (uiRef.current === 'running') sfx.current?.resume() // allowed after a recent click (e.g. Start run)
    const off = unlockOnNextGesture()
    return () => { off(); sfx.current?.quiet() }
  }, [])

  // 2D tile size (2D view) or minimap size (3D view).
  const tile2d = Math.max(8, Math.min(32, Math.floor(Math.min(box.w / cfg.maze.width, box.h / cfg.maze.height))))
  const mapTile = mode === '3d' ? MINIMAP_TILE : tile2d
  const mapTileRef = useRef(mapTile)

  // Fit to the available width; on phones keep it within the screen height.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      const h = Math.floor(Math.min(window.innerHeight * 0.72, w * 0.66))
      setBox({ w, h })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Resizing changes canvas sizes only; it never restarts the game.
  useEffect(() => {
    boxRef.current = box
    mapTileRef.current = mapTile
    const dpr = window.devicePixelRatio || 1
    const map = mapRef.current
    if (map) {
      map.width = cfg.maze.width * mapTile * dpr
      map.height = cfg.maze.height * mapTile * dpr
    }
  }, [box, mapTile, cfg.maze.width, cfg.maze.height])

  useEffect(() => {
    const map = mapRef.current
    const wrap = wrapRef.current
    if (!map || !wrap) return
    const ctx = map.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const s = createGame(cfg)
    const log: InputLog = []
    let pending: Dir = Dir.None
    const motion = new Motion(s)
    let acc = 0
    let last = performance.now()
    let startAt = Number.POSITIVE_INFINITY // set when the player starts
    let lastBeep = -1
    let raf = 0
    let ended = false
    let scene: CityScene | null = null
    let disposed = false
    let sceneSize = ''

    if (mode === '3d' && glRef.current) {
      const canvas = glRef.current
      import('./three/CityScene')
        .then(({ CityScene }) => {
          if (disposed) return
          scene = new CityScene(canvas, cfg, weather)
        })
        .catch((e) => {
          console.warn('[3d] falling back to 2D:', e)
          if (!disposed) setMode('2d')
        })
    }

    const sound = sfx.current
    const press = (d: Dir) => { pending = d }
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && (uiRef.current === 'running' || uiRef.current === 'paused')) {
        e.preventDefault()
        if (uiRef.current === 'running') { setUiBoth('paused'); sound?.setPaused(true) } else { setUiBoth('running'); sound?.resume(); sound?.setPaused(false) }
        return
      }
      if ((e.key === 'Enter' || e.key === ' ') && uiRef.current === 'ready') {
        e.preventDefault()
        sound?.resume()
        setUiBoth('running')
        return
      }
      const d = KEYS[e.key]
      if (d) {
        e.preventDefault()
        if (uiRef.current === 'running') press(d)
      }
    }
    let touch: { x: number; y: number } | null = null
    const onTouchStart = (e: TouchEvent) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
    const onTouchMove = (e: TouchEvent) => {
      if (!touch) return
      const dx = e.touches[0].clientX - touch.x, dy = e.touches[0].clientY - touch.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
      press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.Right : Dir.Left) : (dy > 0 ? Dir.Down : Dir.Up))
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    wrap.addEventListener('touchstart', onTouchStart, { passive: true })
    wrap.addEventListener('touchmove', onTouchMove, { passive: false })

    const frame = (now: number) => {
      const state = uiRef.current
      if (state === 'running' && startAt === Number.POSITIVE_INFINITY) startAt = now + COUNTDOWN_MS
      // While paused (or not started) wall time passes but game time does not.
      if (state !== 'running') {
        if (startAt !== Number.POSITIVE_INFINITY) startAt += now - last
        last = now
      }
      const countdown = startAt === Number.POSITIVE_INFINITY ? COUNTDOWN_MS : Math.max(0, startAt - now)
      const sec = Math.ceil(countdown / 1000)
      if (state === 'running' && countdown > 0 && sec !== lastBeep) { lastBeep = sec; sound?.countdown(false) }
      if (state === 'running' && countdown === 0 && lastBeep !== 0) { lastBeep = 0; sound?.countdown(true) }
      if (state === 'running' && countdown === 0 && !ended) {
        acc += Math.min(now - last, MAX_FRAME_MS)
        while (acc >= TICK_MS && s.status === 'playing') {
          acc -= TICK_MS
          const prevDir = s.player.dir
          if (pending !== Dir.None) {
            log.push([s.tick, pending])
            step(cfg, s, pending)
            pending = Dir.None
          } else {
            step(cfg, s)
          }
          motion.update(s)
          if (prevDir !== Dir.None && s.player.dir !== prevDir) sound?.screech(cfg.modifiers.slipTiles > 0)
          for (const e of s.events) {
            if (e.type === 'loot') sound?.loot()
            else if (e.type === 'exitOpen') sound?.exitOpen()
            else if (e.type === 'smoke') sound?.smoke()
            else if (e.type === 'spotted') sound?.spotted()
            else if (e.type === 'caught') sound?.caught()
            else if (e.type === 'end') (e.status === 'escaped' ? sound?.escape() : sound?.busted())
          }
        }
      }
      // Engine and siren only while actually driving; silent on start/pause/end screens.
      if (state === 'running' && s.status === 'playing') {
        sound?.update(countdown === 0 && s.player.dir !== Dir.None, s.cops.some((c) => c.status === 'chase'), now)
      } else {
        sound?.quiet()
      }
      last = now
      const alpha = countdown > 0 ? 0 : Math.min(1, acc / TICK_MS)
      const pos = motion.sample(s, alpha)

      if (scene) {
        const { w, h } = boxRef.current
        const key = `${w}x${h}`
        if (key !== sceneSize) { scene.setSize(w, h); sceneSize = key }
        try {
          const at = scene.render(s, pos, now)
          // Night: keep the visible circle centred on the car, wherever the camera is.
          if (nightRef.current) {
            nightRef.current.style.background =
              `radial-gradient(circle at ${(at.x * 100).toFixed(1)}% ${(at.y * 100).toFixed(1)}%, transparent 14%, rgba(3,4,8,0.86) 40%)`
          }
        } catch (e) {
          console.warn('[3d] render failed, falling back to 2D:', e)
          scene.dispose()
          scene = null
          setMode('2d')
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawFrame(ctx, cfg, s, pos, mapTileRef.current, now, dpr)

      cb.current.onHud({
        score: s.score, lives: s.lives, status: s.status,
        secondsLeft: Math.ceil((maxTicks - s.tick) / TICK_RATE),
        countdown: Math.ceil(countdown / 1000),
        lootTaken: s.lootTaken,
        lootTotal: s.loot.length,
        lootToOpen: Math.min(LOOT_TO_OPEN_EXIT, s.loot.length),
        exitOpen: s.exit.open,
        wanted: s.cops.some((c) => c.status === 'chase'),
        heat: s.heat,
      })
      if (s.status !== 'playing' && !ended) {
        ended = true
        setFinal({ status: s.status, score: s.score, loot: s.lootTaken })
        setUiBoth('ended')
        sound?.quiet()
        cb.current.onEnd(log, s)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      sound?.quiet()
      cancelAnimationFrame(raf)
      scene?.dispose()
      window.removeEventListener('keydown', onKey)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchmove', onTouchMove)
    }
    // A new cfg (or switching view) means a new game.
  }, [cfg, maxTicks, mode, weather])

  const night = cfg.modifiers.visionRadius !== null
  const start = () => { sfx.current?.resume(); sfx.current?.setPaused(false); sfx.current?.click(); setUiBoth('running') }
  const togglePause = () => {
    if (ui === 'running') { setUiBoth('paused'); sfx.current?.setPaused(true) }
    else if (ui === 'paused') { setUiBoth('running'); sfx.current?.resume(); sfx.current?.setPaused(false) }
  }
  const toggleMute = () => { const m = !muted; setMuted(m); sfx.current?.setMuted(m) }
  const btn = 'rounded-lg px-5 py-2.5 font-bold'
  const primary = `${btn} bg-cyan-400 text-black shadow-[0_0_18px_#37f5ff] hover:bg-cyan-300`
  const secondary = `${btn} border border-white/30 text-white hover:bg-white/10`

  const overlays = (
    <>
      <div className="absolute left-2 top-2 z-30 flex gap-2">
        {(ui === 'running' || ui === 'paused') && (
          <button onClick={togglePause} className="rounded-md bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur" data-testid="pause-button" aria-label={ui === 'paused' ? 'Resume' : 'Pause'}>
            {ui === 'paused' ? '▶ Resume' : '❚❚ Pause'}
          </button>
        )}
        <button onClick={toggleMute} className="rounded-md bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur" data-testid="mute-button" aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
      {ui !== 'running' && !(ui === 'ended' && !showEndScreen) && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-xl bg-black/65 text-center text-white backdrop-blur-sm" data-testid={`screen-${ui}`}>
          {ui === 'ready' && (
            <>
              <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-300">City Chase</p>
              <h2 className="text-3xl font-black" style={{ textShadow: '0 0 18px #37f5ff' }}>Ready for the heist?</h2>
              <p className="max-w-sm text-sm opacity-80">Arrows / WASD / swipe to drive. Esc or P pauses.</p>
              <button onClick={start} className={primary} data-testid="start-button">Start</button>
            </>
          )}
          {ui === 'paused' && (
            <>
              <h2 className="text-3xl font-black">Paused</h2>
              <div className="flex gap-3">
                <button onClick={togglePause} className={primary} data-testid="resume-button">Resume</button>
                {onRestart && <button onClick={onRestart} className={secondary} data-testid="restart-button">Restart</button>}
                {onQuit && <button onClick={onQuit} className={secondary} data-testid="quit-button">Quit</button>}
              </div>
            </>
          )}
          {ui === 'ended' && final && (
            <>
              <h2 className="text-3xl font-black">{OUTCOME[final.status] ?? final.status}</h2>
              <p className="font-mono">{final.score.toLocaleString('en-US')} pts · {final.loot} loot</p>
              <div className="flex gap-3">
                {onRestart && <button onClick={onRestart} className={primary} data-testid="again-button">Play again</button>}
                {onQuit && <button onClick={onQuit} className={secondary} data-testid="quit-button">Quit</button>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
  const mapW = cfg.maze.width * mapTile, mapH = cfg.maze.height * mapTile

  return (
    <div ref={wrapRef} className="relative w-full" style={{ touchAction: 'none' }} data-testid="game-view" data-view={mode}>
      {mode === '3d' ? (
        // Distinct keys: a canvas that already has a 2D context can never give a
        // WebGL one, so switching views must mount fresh canvas elements.
        <div key="view-3d" className="relative overflow-hidden rounded-xl" style={{ width: box.w, height: box.h, background: '#0b0d12' }}>
          <canvas ref={glRef} data-testid="game-canvas" style={{ width: box.w, height: box.h, display: 'block' }} />
          {night && <div ref={nightRef} className="pointer-events-none absolute inset-0" />}
          {overlays}
          <canvas
            ref={mapRef}
            data-testid="minimap"
            className="absolute right-2 top-2 rounded-md border border-white/20 shadow-lg"
            style={{ width: mapW, height: mapH, opacity: 0.92 }}
          />
        </div>
      ) : (
        <div key="view-2d" className="flex justify-center">
          <div className="relative" style={{ width: mapW, height: mapH }}>
            <canvas ref={mapRef} data-testid="game-canvas" className="rounded-xl" style={{ width: mapW, height: mapH }} />
            {overlays}
          </div>
        </div>
      )}
    </div>
  )
}
