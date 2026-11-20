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
  CLEAR_WEATHER, Dir, Gadget, LOOT_TO_OPEN_EXIT, TICK_RATE, createGame, step,
  type GadgetKind, type GameConfig, type Input, type GameState, type InputLog, type WeatherSnapshot,
} from '../engine'
import { Motion, shouldHoldTurn } from './motion'
import { getSfx, unlockOnNextGesture, type Sfx } from './sound'
import { RADIO_TEXT } from './radio-lines'
import { drawFrame } from './renderer'
import type { CityScene } from './three/CityScene'

const TICK_MS = 1000 / TICK_RATE
/** Large frame gaps (tab hidden, slow device) slow the game down instead of skipping ticks. */
const MAX_FRAME_MS = 250
const COUNTDOWN_MS = 3000
const MINIMAP_TILE = 6

export type View = '3d' | '2d'

/** Small line icons (inherit text colour) so buttons look consistent across platforms. */
function Icon({ name }: { name: 'restart' | 'quit' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  return name === 'restart' ? (
    <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
  ) : (
    <svg {...common}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></svg>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/80">{children}</kbd>
}

const GADGET_KEYS: Record<string, Gadget> = {
  '1': Gadget.Nitro, '2': Gadget.Oil, '3': Gadget.Disguise,
  q: Gadget.Nitro, e: Gadget.Oil, r: Gadget.Disguise, Q: Gadget.Nitro, E: Gadget.Oil, R: Gadget.Disguise,
}

export const GADGETS: Array<{ kind: GadgetKind; input: Gadget; icon: string; label: string; key: string; color: string }> = [
  { kind: 'nitro', input: Gadget.Nitro, icon: '🔥', label: 'Nitro', key: '1', color: '#ff6a1a' },
  { kind: 'oil', input: Gadget.Oil, icon: '🛢️', label: 'Oil', key: '2', color: '#8a5cff' },
  { kind: 'disguise', input: Gadget.Disguise, icon: '🎭', label: 'Disguise', key: '3', color: '#2fd8ff' },
]

/** A recorded run to race against: replayed tick by tick next to yours. */
export interface GhostRun { cfg: GameConfig; log: InputLog; name: string; score: number }

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
  /** The police radio line currently being spoken, for subtitles. */
  radio: string | null
  /** Seconds until you can drive again after being caught (0 = driving). */
  respawnIn: number
  gadgets: Record<GadgetKind, number>
  /** Gadgets currently running. */
  active: { nitro: boolean; disguise: boolean }
  /** Ghost race: the ghost's live score, or null without a ghost. */
  ghostScore: number | null
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
  waitForStart = false, showEndScreen = false, onRestart, onQuit, fill = false, children, ghost,
}: {
  /** Optional ghost run to race against. */
  ghost?: GhostRun | null
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
  /** Take the whole parent (full-screen game). */
  fill?: boolean
  /** Overlays drawn above the game (e.g. the HUD). */
  children?: React.ReactNode
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
  const lastHud = useRef<Hud | null>(null)
  const gadgetRef = useRef<(g: Gadget) => void>(() => {})
  const cb = useRef({ onHud: (h: Hud) => { lastHud.current = h; onHud(h) }, onEnd })
  cb.current = { onHud: (h: Hud) => { lastHud.current = h; onHud(h) }, onEnd }

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
      const h = fill ? el.clientHeight : Math.floor(Math.min(window.innerHeight * 0.72, w * 0.66))
      setBox({ w, h })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])

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
    let pendingGadget: Gadget | null = null
    const motion = new Motion(s)
    // Ghost: its own game on the same streets, driven by its recorded inputs.
    const gs = ghost ? createGame(ghost.cfg) : null
    const ghostMotion = gs ? new Motion(gs) : null
    let gk = 0
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
        .then(({ CityScene }) => CityScene.create(canvas, cfg, weather))
        .then((created) => {
          if (disposed) { created.dispose(); return }
          scene = created
        })
        .catch((e) => {
          console.warn('[3d] falling back to 2D:', e)
          if (!disposed) setMode('2d')
        })
    }

    const sound = sfx.current
    // Police radio: fetch the voice clips (cached on the server) and decode them.
    let radioText: string | null = null
    let radioUntil = 0
    let lastSpotted = -Infinity
    let started = false
    fetch('/api/radio').then((r) => r.json() as Promise<{ data?: Record<string, string> }>).then((b) => sound?.loadRadio(b.data ?? {})).catch(() => {})
    const say = (id: string, text: string, now: number) => {
      if (sound?.radio(id)) { radioText = text; radioUntil = now + 4000 }
    }
    const press = (d: Dir) => { pending = d }
    gadgetRef.current = (g: Gadget) => { if (uiRef.current === 'running') pendingGadget = g }
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
      const g = GADGET_KEYS[e.key]
      if (g) {
        e.preventDefault()
        gadgetRef.current(g)
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
      if (state === 'running' && countdown === 0 && !started) { started = true; say('start', RADIO_TEXT.start, now) }
      if (state === 'running' && countdown === 0 && !ended) {
        acc += Math.min(now - last, MAX_FRAME_MS)
        while (acc >= TICK_MS && s.status === 'playing') {
          acc -= TICK_MS
          const prevDir = s.player.dir
          // A side turn pressed after the car has visibly passed the junction
          // centre waits until the car moves on (it then applies at the next road).
          if (gs && ghostMotion && gs.status === 'playing') {
            let gi: Input = Dir.None
            if (gk < ghost!.log.length && ghost!.log[gk][0] === gs.tick) gi = ghost!.log[gk++][1]
            step(ghost!.cfg, gs, gi)
            ghostMotion.update(gs)
          }
          // A gadget goes in on its own tick; a pending turn waits one tick.
          if (pendingGadget !== null) {
            log.push([s.tick, pendingGadget])
            step(cfg, s, pendingGadget)
            pendingGadget = null
          } else if (pending !== Dir.None && !shouldHoldTurn(cfg.maze, s, pending)) {
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
            else if (e.type === 'exitOpen') { sound?.exitOpen(); say('safehouse', RADIO_TEXT.safehouse, now) }
            else if (e.type === 'smoke') { sound?.smoke(); if (e.blinded > 0) say('smoke', RADIO_TEXT.smoke, now) }
            else if (e.type === 'spotted') {
              sound?.spotted()
              if (now - lastSpotted > 8000) { lastSpotted = now; say('spotted', RADIO_TEXT.spotted, now) }
            }
            else if (e.type === 'gadget') sound?.smoke()
            else if (e.type === 'crate') sound?.loot()
            else if (e.type === 'spinout') sound?.screech(true)
            else if (e.type === 'caught') { sound?.caught(); say('caught', RADIO_TEXT.caught, now) }
            else if (e.type === 'end') {
              if (e.status === 'escaped') { sound?.escape(); say('escaped', RADIO_TEXT.escaped, now) } else sound?.busted()
            }
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
      const pos = motion.sample(s, alpha, cfg.maze)
      const gp = gs && ghostMotion ? ghostMotion.sample(gs, gs.status === 'playing' ? alpha : 1, ghost!.cfg.maze)[0] : null
      const ghostPose = gs && gp ? { x: gp.x, y: gp.y, dir: gs.player.dir, done: gs.status !== 'playing' } : null

      if (scene) {
        const { w, h } = boxRef.current
        const key = `${w}x${h}`
        if (key !== sceneSize) { scene.setSize(w, h); sceneSize = key }
        try {
          const at = scene.render(s, pos, now, ghostPose)
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
      drawFrame(ctx, cfg, s, pos, mapTileRef.current, now, dpr, ghostPose)

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
        radio: now < radioUntil ? radioText : null,
        respawnIn: s.status === 'playing' && s.pauseUntil > s.tick ? Math.ceil((s.pauseUntil - s.tick) / TICK_RATE) : 0,
        gadgets: { ...s.gadgets },
        active: { nitro: s.tick < s.nitroUntil, disguise: s.tick < s.disguiseUntil },
        ghostScore: gs ? gs.score : null,
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
  }, [cfg, maxTicks, mode, weather, ghost])

  const night = cfg.modifiers.visionRadius !== null
  const start = () => { sfx.current?.resume(); sfx.current?.setPaused(false); sfx.current?.click(); setUiBoth('running') }
  const togglePause = () => {
    if (ui === 'running') { setUiBoth('paused'); sfx.current?.setPaused(true) }
    else if (ui === 'paused') { setUiBoth('running'); sfx.current?.resume(); sfx.current?.setPaused(false) }
  }
  const toggleMute = () => { const m = !muted; setMuted(m); sfx.current?.setMuted(m) }
  const btn = 'rounded-xl px-6 py-3 font-bold transition hover:scale-[1.03]'
  const primary = `${btn} bg-orange-500 text-black shadow-[0_0_28px_rgba(255,138,31,0.6)] hover:bg-orange-400`
  const secondary = `${btn} border border-white/20 bg-white/5 text-white hover:bg-white/10`
  const card = 'w-[min(92vw,460px)] rounded-3xl border border-white/15 bg-black/60 px-8 py-7 text-center shadow-2xl'
  const snap = lastHud.current

  const overlays = (
    <>
      <div className={`absolute z-30 flex gap-2 ${fill ? 'bottom-3 left-3' : 'left-2 top-2'}`}>
        {(ui === 'running' || ui === 'paused') && (
          <button onClick={togglePause} className="rounded-md bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur" data-testid="pause-button" aria-label={ui === 'paused' ? 'Resume' : 'Pause'}>
            {ui === 'paused' ? '▶ Resume' : '❚❚ Pause'}
          </button>
        )}
        <button onClick={toggleMute} className="rounded-md bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur" data-testid="mute-button" aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
      {ui === 'running' && snap && (
        <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 gap-2" data-testid="gadget-bar">
          {GADGETS.map((g) => {
            const n = snap.gadgets[g.kind]
            const on = (g.kind === 'nitro' && snap.active.nitro) || (g.kind === 'disguise' && snap.active.disguise)
            return (
              <button
                key={g.kind}
                onClick={() => gadgetRef.current(g.input)}
                disabled={n === 0 && !on}
                className="relative flex w-16 flex-col items-center rounded-xl border bg-black/60 px-2 py-1.5 text-white backdrop-blur transition disabled:opacity-35 sm:w-20"
                style={{ borderColor: on ? g.color : 'rgba(255,255,255,0.2)', boxShadow: on ? `0 0 18px ${g.color}` : undefined }}
                data-testid={`gadget-${g.kind}`}
                aria-label={`${g.label} (${n} left)`}
              >
                <span className="text-xl leading-none">{g.icon}</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wider text-white/70">{g.label}</span>
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-black" style={{ background: g.color }}>{n}</span>
                <span className="absolute left-1 top-0.5 hidden font-mono text-[9px] text-white/40 sm:block">{g.key}</span>
              </button>
            )
          })}
        </div>
      )}
      {ui !== 'running' && !(ui === 'ended' && !showEndScreen) && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center bg-black/55 text-white backdrop-blur-md ${fill ? '' : 'rounded-xl'}`} data-testid={`screen-${ui}`}>
          {ui === 'ready' && (
            <div className={card}>
              <p className="text-[11px] uppercase tracking-[0.35em] text-orange-300">City Chase</p>
              <h2 className="mt-2 text-4xl font-black" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>Ready for the heist?</h2>
              <p className="mt-2 text-sm text-white/70">Grab the loot, reach the safehouse, stay out of the headlights.</p>
              <button onClick={start} className={`${primary} mt-6 w-full text-lg`} data-testid="start-button">▶ Start</button>
              <p className="mt-4 text-xs text-white/45"><Kbd>←↑↓→</Kbd> / <Kbd>WASD</Kbd> / swipe to drive · <Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd> gadgets · <Kbd>Esc</Kbd> pauses</p>
            </div>
          )}
          {ui === 'paused' && (
            <div className={card}>
              <p className="text-[11px] uppercase tracking-[0.35em] text-orange-300">Heist on hold</p>
              <h2 className="mt-1 text-5xl font-black tracking-tight" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>PAUSED</h2>
              {snap && (
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    { k: 'Score', v: snap.score.toLocaleString('en-US') },
                    { k: 'Loot', v: `${snap.lootTaken}/${snap.lootTotal}` },
                    { k: 'Time left', v: `${Math.floor(snap.secondsLeft / 60)}:${String(snap.secondsLeft % 60).padStart(2, '0')}` },
                  ].map((t) => (
                    <div key={t.k} className="rounded-2xl border border-white/10 bg-white/5 py-2.5">
                      <p className="font-mono text-lg font-bold tabular-nums">{t.v}</p>
                      <p className="text-[10px] uppercase tracking-wider text-white/45">{t.k}</p>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={togglePause} className={`${primary} mt-6 w-full text-lg`} data-testid="resume-button">▶ Resume</button>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {onRestart && <button onClick={onRestart} className={`${secondary} inline-flex items-center justify-center gap-2`} data-testid="restart-button"><Icon name="restart" />Restart</button>}
                {onQuit && <button onClick={onQuit} className={`${secondary} inline-flex items-center justify-center gap-2`} data-testid="quit-button"><Icon name="quit" />Quit</button>}
              </div>
              <p className="mt-4 text-xs text-white/45"><Kbd>Esc</Kbd> or <Kbd>P</Kbd> to resume</p>
            </div>
          )}
          {ui === 'ended' && final && (
            <div className={card}>
              <h2 className="text-4xl font-black" style={{ textShadow: '0 0 24px rgba(255,138,31,0.6)' }}>{OUTCOME[final.status] ?? final.status}</h2>
              <p className="mt-2 font-mono text-2xl">{final.score.toLocaleString('en-US')} pts · {final.loot} loot</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {onRestart && <button onClick={onRestart} className={primary} data-testid="again-button">▶ Play again</button>}
                {onQuit && <button onClick={onQuit} className={`${secondary} inline-flex items-center justify-center gap-2`} data-testid="quit-button"><Icon name="quit" />Quit</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
  const mapW = cfg.maze.width * mapTile, mapH = cfg.maze.height * mapTile

  return (
    <div ref={wrapRef} className={`relative w-full ${fill ? 'h-full' : ''}`} style={{ touchAction: 'none' }} data-testid="game-view" data-view={mode}>
      {mode === '3d' ? (
        // Distinct keys: a canvas that already has a 2D context can never give a
        // WebGL one, so switching views must mount fresh canvas elements.
        <div key="view-3d" className={`relative overflow-hidden ${fill ? '' : 'rounded-xl'}`} style={{ width: box.w, height: box.h, background: '#0b0d12' }}>
          <canvas ref={glRef} data-testid="game-canvas" style={{ width: box.w, height: box.h, display: 'block' }} />
          {night && <div ref={nightRef} className="pointer-events-none absolute inset-0" />}
          {overlays}
          {children}
          <canvas
            ref={mapRef}
            data-testid="minimap"
            className={`absolute rounded-md border border-white/20 shadow-lg ${fill ? 'bottom-3 right-3' : 'right-2 top-2'}`}
            style={{ width: mapW, height: mapH, opacity: 0.92 }}
          />
        </div>
      ) : (
        <div key="view-2d" className="flex justify-center">
          <div className="relative" style={{ width: mapW, height: mapH }}>
            <canvas ref={mapRef} data-testid="game-canvas" className="rounded-xl" style={{ width: mapW, height: mapH }} />
            {overlays}
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
