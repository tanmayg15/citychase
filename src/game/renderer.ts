/**
 * Neon canvas renderer. Pure drawing: reads engine state, never changes it.
 * Entities move a whole tile per engine step; we interpolate between the
 * previous and current tick so motion looks smooth.
 */
import { Cell, Dir, type GameConfig, type GameState } from '../engine'

export const PALETTE = {
  bg: '#07030f',
  wallFill: '#160a33',
  wallGlow: '#8b5cf6',
  orb: '#ffe066',
  core: '#ff4fd8',
  runner: '#37f5ff',
  ghosts: ['#ff6b3d', '#a3ff3d', '#c084fc', '#ff3d6e'],
  frightened: '#3d7bff',
  text: '#e8e0ff',
}

import type { Pos } from './motion'

/** Walls never change during a game, so they are drawn once per size into an offscreen canvas. */
const wallCache = new WeakMap<GameConfig, { tile: number; dpr: number; canvas: HTMLCanvasElement }>()

function wallLayer(cfg: GameConfig, tile: number, dpr: number): HTMLCanvasElement {
  const hit = wallCache.get(cfg)
  if (hit && hit.tile === tile && hit.dpr === dpr) return hit.canvas
  const { width: w, height: h } = cfg.maze
  const canvas = document.createElement('canvas')
  canvas.width = w * tile * dpr
  canvas.height = h * tile * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = PALETTE.bg
  ctx.fillRect(0, 0, w * tile, h * tile)
  ctx.fillStyle = PALETTE.wallFill
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cfg.maze.cells[y * w + x] === Cell.Wall) ctx.fillRect(x * tile, y * tile, tile, tile)
  }
  ctx.strokeStyle = PALETTE.wallGlow
  ctx.lineWidth = Math.max(1.5, tile / 9)
  ctx.shadowColor = PALETTE.wallGlow
  ctx.shadowBlur = tile / 2
  ctx.beginPath()
  const isWall = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h || cfg.maze.cells[y * w + x] === Cell.Wall
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isWall(x, y)) continue
    const px = x * tile, py = y * tile
    if (!isWall(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + tile, py) }
    if (!isWall(x, y + 1)) { ctx.moveTo(px, py + tile); ctx.lineTo(px + tile, py + tile) }
    if (!isWall(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + tile) }
    if (!isWall(x + 1, y)) { ctx.moveTo(px + tile, py); ctx.lineTo(px + tile, py + tile) }
  }
  ctx.stroke()
  wallCache.set(cfg, { tile, dpr, canvas })
  return canvas
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cfg: GameConfig,
  s: GameState,
  pos: Pos[],
  tile: number,
  timeMs: number,
  dpr: number,
): void {
  const { width: w, height: h } = cfg.maze
  ctx.save()
  ctx.drawImage(wallLayer(cfg, tile, dpr), 0, 0, w * tile, h * tile)

  // Orbs and power cores.
  const pulse = 0.75 + 0.25 * Math.sin(timeMs / 180)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = s.cells[y * w + x]
    if (c === Cell.Orb) {
      ctx.shadowBlur = 0; ctx.fillStyle = PALETTE.orb
      ctx.beginPath(); ctx.arc((x + 0.5) * tile, (y + 0.5) * tile, tile * 0.11, 0, Math.PI * 2); ctx.fill()
    } else if (c === Cell.Core) {
      ctx.shadowColor = PALETTE.core; ctx.shadowBlur = tile; ctx.fillStyle = PALETTE.core
      ctx.beginPath(); ctx.arc((x + 0.5) * tile, (y + 0.5) * tile, tile * 0.3 * pulse, 0, Math.PI * 2); ctx.fill()
    }
  }

  // Ghosts: rounded "drones" with a visor.
  const powerLeft = s.powerUntil ? s.powerUntil - s.tick : 0
  s.ghosts.forEach((g, i) => {
    if (g.status === 'house' && s.tick < g.releaseTick - 200) return
    const p = pos[i + 1] ?? g
    const cx = (p.x + 0.5) * tile, cy = (p.y + 0.5) * tile, r = tile * 0.42
    let color = PALETTE.ghosts[i % PALETTE.ghosts.length]
    if (g.status === 'frightened') {
      color = powerLeft < 40 && Math.floor(timeMs / 150) % 2 ? '#ffffff' : PALETTE.frightened
    }
    ctx.shadowColor = color; ctx.shadowBlur = tile / 1.5
    if (g.status !== 'eaten') {
      ctx.globalAlpha = g.status === 'house' ? 0.45 : 1
      ctx.fillStyle = color
      ctx.beginPath(); ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.6); ctx.fill()
      ctx.globalAlpha = 1
    }
    // Visor points the way the ghost is moving.
    const dx = [0, 0, 1, 0, -1][g.dir] * r * 0.25, dy = [0, -1, 0, 1, 0][g.dir] * r * 0.25
    ctx.shadowBlur = 0
    ctx.fillStyle = g.status === 'eaten' ? color : PALETTE.bg
    ctx.fillRect(cx - r * 0.6 + dx, cy - r * 0.25 + dy, r * 1.2, r * 0.38)
  })

  // Runner: a glowing arrowhead pointing where it is heading.
  const pp = pos[0] ?? s.player
  const cx = (pp.x + 0.5) * tile, cy = (pp.y + 0.5) * tile, r = tile * 0.42
  const angle = [0, -Math.PI / 2, 0, Math.PI / 2, Math.PI][s.player.dir === Dir.None ? Dir.Up : s.player.dir]
  ctx.shadowColor = PALETTE.runner; ctx.shadowBlur = tile
  ctx.fillStyle = PALETTE.runner
  ctx.save()
  ctx.translate(cx, cy); ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(r, 0); ctx.lineTo(-r * 0.8, r * 0.8); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.8, -r * 0.8)
  ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.restore()

  // Night: only a circle around the runner stays visible.
  const vision = cfg.modifiers.visionRadius
  if (vision !== null) {
    ctx.save()
    const g = ctx.createRadialGradient(cx, cy, tile * (vision - 1.5), cx, cy, tile * vision)
    g.addColorStop(0, 'rgba(7,3,15,0)')
    g.addColorStop(1, 'rgba(7,3,15,0.94)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w * tile, h * tile)
    ctx.restore()
  }
}
