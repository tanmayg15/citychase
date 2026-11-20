/**
 * Lobby background: a real game of City Chase played by the bot, filmed by a
 * slowly orbiting camera. Purely decorative (no scores, no input). Falls back
 * to a dark gradient if WebGL is unavailable.
 */
import { useEffect, useRef, useState } from 'react'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, Dir, TICK_RATE, createGame, step, type WeatherSnapshot,
} from '../engine'
import { getCity } from '../cities'
import { botDir } from './bot'
import { buildConfig } from '../shared/daily'
import { supports3d } from './GameCanvas'
import { Motion } from './motion'

const TICK_MS = 1000 / TICK_RATE

/**
 * Start downloading the 3D engine chunk and the city models right away, in
 * parallel with the rest of the page, instead of after the lobby renders.
 * Safe to call many times.
 */
let preloading: Promise<unknown> | null = null
export function preloadCity(): void {
  if (preloading || typeof window === 'undefined' || !supports3d()) return
  preloading = Promise.all([import('./three/CityScene'), import('./three/assets').then((m) => m.loadModels())]).catch(() => { preloading = null })
}

export function AttractScene({ cityId, weather = CLEAR_WEATHER }: { cityId: string; weather?: WeatherSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !supports3d() || !getCity(cityId)) return
    let disposed = false
    let raf = 0
    let scene: import('./three/CityScene').CityScene | null = null
    let seed = 1
    let cfg = buildConfig({ cityId, seed, weather, plan: DEFAULT_PLAN })
    let s = createGame(cfg)
    let motion = new Motion(s)
    let acc = 0
    let last = performance.now()
    let shown = false

    const resize = () => {
      if (!scene) return
      scene.setSize(window.innerWidth, window.innerHeight)
    }

    import('./three/CityScene').then(({ CityScene }) => CityScene.create(canvas, cfg, weather)).then((created) => {
      if (disposed) { created.dispose(); return }
      scene = created
      scene.cinematic = true
      resize()
      const frame = (now: number) => {
        acc += Math.min(now - last, 250)
        last = now
        while (acc >= TICK_MS) {
          acc -= TICK_MS
          step(cfg, s, s.player.clock === 0 ? botDir(cfg.maze, s) : Dir.None)
          motion.update(s)
          if (s.status !== 'playing') {
            seed++
            cfg = buildConfig({ cityId, seed, weather, plan: DEFAULT_PLAN })
            s = createGame(cfg)
            motion = new Motion(s)
          }
        }
        scene?.render(s, motion.sample(s, acc / TICK_MS), now)
        if (!shown) { shown = true; setReady(true) } // fade in after the first real frame
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    }).catch(() => { /* no 3D: the gradient behind stays */ })

    window.addEventListener('resize', resize)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      scene?.dispose()
    }
  }, [cityId, weather])

  return (
    <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1b1240, #07030f 70%)' }}>
      <canvas ref={ref} className="h-full w-full transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }} aria-hidden="true" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(7,3,15,0.88) 0%, rgba(7,3,15,0.35) 45%, rgba(7,3,15,0.55) 100%)' }} />
    </div>
  )
}
