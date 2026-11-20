/**
 * Runs one game in the browser: fixed 20 Hz ticks on a requestAnimationFrame
 * loop, keyboard + swipe input, and a recorded input log. The log is exactly
 * what the server replays, so whatever happens here must go through step().
 */
import { useEffect, useRef, useState } from 'react'
import {
  Dir, TICK_RATE, createGame, step,
  type GameConfig, type GameState, type InputLog,
} from '../engine'
import { Motion } from './motion'
import { drawFrame } from './renderer'

const TICK_MS = 1000 / TICK_RATE
/** Large frame gaps (tab hidden, slow device) slow the game down instead of skipping ticks. */
const MAX_FRAME_MS = 250
const COUNTDOWN_MS = 3000

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
  powered: boolean
}

export function GameCanvas({
  cfg, maxTicks, onHud, onEnd,
}: {
  cfg: GameConfig
  maxTicks: number
  onHud: (h: Hud) => void
  onEnd: (log: InputLog, final: GameState) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tile, setTile] = useState(20)
  const tileRef = useRef(tile)
  const cb = useRef({ onHud, onEnd })
  cb.current = { onHud, onEnd }

  // Resizing only changes the canvas size; it never restarts the game.
  useEffect(() => {
    tileRef.current = tile
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = cfg.maze.width * tile * dpr
    canvas.height = cfg.maze.height * tile * dpr
  }, [tile, cfg.maze.width, cfg.maze.height])

  // Fit the maze to the available width (and height on phones).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const maxH = window.innerHeight * 0.72
      const t = Math.floor(Math.min(el.clientWidth / cfg.maze.width, maxH / cfg.maze.height))
      setTile(Math.max(8, Math.min(32, t)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cfg.maze.width, cfg.maze.height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const s = createGame(cfg)
    const log: InputLog = []
    let pending: Dir = Dir.None
    const motion = new Motion(s)
    let acc = 0
    let last = performance.now()
    const startAt = last + COUNTDOWN_MS
    let raf = 0
    let ended = false

    const press = (d: Dir) => { pending = d }
    const onKey = (e: KeyboardEvent) => {
      const d = KEYS[e.key]
      if (d) { e.preventDefault(); press(d) }
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
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })

    const frame = (now: number) => {
      const countdown = Math.max(0, startAt - now)
      if (countdown === 0 && !ended) {
        acc += Math.min(now - last, MAX_FRAME_MS)
        while (acc >= TICK_MS && s.status === 'playing') {
          acc -= TICK_MS
          if (pending !== Dir.None) {
            log.push([s.tick, pending])
            step(cfg, s, pending)
            pending = Dir.None
          } else {
            step(cfg, s)
          }
          motion.update(s)
        }
      }
      last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const alpha = countdown > 0 ? 0 : Math.min(1, acc / TICK_MS)
      drawFrame(ctx, cfg, s, motion.sample(s, alpha), tileRef.current, now, dpr)
      cb.current.onHud({
        score: s.score, lives: s.lives, status: s.status,
        secondsLeft: Math.ceil((maxTicks - s.tick) / TICK_RATE),
        countdown: Math.ceil(countdown / 1000),
        powered: s.powerUntil > s.tick,
      })
      if (s.status !== 'playing' && !ended) {
        ended = true
        cb.current.onEnd(log, s)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
    }
    // A new cfg means a new game.
  }, [cfg, maxTicks])

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        data-testid="game-canvas"
        style={{ width: cfg.maze.width * tile, height: cfg.maze.height * tile, touchAction: 'none' }}
        className="rounded-xl"
      />
    </div>
  )
}
