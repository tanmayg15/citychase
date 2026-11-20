/**
 * Top-down city-map renderer for the heist. Pure drawing: reads engine state,
 * never changes it. Static parts (buildings, roads, lane markings) are drawn
 * once per size into an offscreen canvas.
 */
import { beamTiles, Cell, Dir, type CopState, type GameConfig, type GameState } from '../engine'
import { predictNextDir, type Pos } from './motion'

export const PALETTE = {
  night: '#05060a',
  asphalt: '#22252e',
  laneMark: 'rgba(255, 214, 102, 0.55)',
  crosswalk: 'rgba(235, 238, 245, 0.55)',
  roofs: ['#3b4252', '#434c5e', '#4c566a', '#3a3f4b', '#504a5e', '#3f4a4a', '#55505a'],
  roofEdge: 'rgba(0,0,0,0.45)',
  getaway: '#ff8a1f',
  copBody: '#f2f4f8',
  copHood: '#1c2333',
  sirenRed: '#ff3b4e',
  sirenBlue: '#3b8bff',
  loot: '#ffd23f',
  smoke: '#9aa3b2',
  exitLocked: '#5c6370',
  exitOpen: '#3dff9a',
  beam: 'rgba(255, 244, 180, 0.13)',
  beamChase: 'rgba(255, 80, 90, 0.18)',
  text: '#e8e0ff',
}

const ANGLE = [0, -Math.PI / 2, 0, Math.PI / 2, Math.PI]

// ─── Static layer ───────────────────────────────────────────────────────────

const staticCache = new WeakMap<GameConfig, { tile: number; dpr: number; canvas: HTMLCanvasElement }>()

/** Label connected building tiles so each city block gets one roof colour. */
function blockIds(cfg: GameConfig): Int32Array {
  const { width: w, height: h, cells } = cfg.maze
  const ids = new Int32Array(w * h).fill(-1)
  let next = 0
  for (let s = 0; s < w * h; s++) {
    if (cells[s] !== Cell.Wall || ids[s] !== -1) continue
    const stack = [s]
    ids[s] = next
    while (stack.length) {
      const k = stack.pop()!
      const x = k % w, y = Math.floor(k / w)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const n = ny * w + nx
        if (cells[n] === Cell.Wall && ids[n] === -1) { ids[n] = next; stack.push(n) }
      }
    }
    next++
  }
  return ids
}

function staticLayer(cfg: GameConfig, tile: number, dpr: number): HTMLCanvasElement {
  const hit = staticCache.get(cfg)
  if (hit && hit.tile === tile && hit.dpr === dpr) return hit.canvas
  const { width: w, height: h, cells } = cfg.maze
  const canvas = document.createElement('canvas')
  canvas.width = w * tile * dpr
  canvas.height = h * tile * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] !== Cell.Wall

  ctx.fillStyle = PALETTE.asphalt
  ctx.fillRect(0, 0, w * tile, h * tile)

  // Buildings: one roof colour per block, a dark edge where it meets the road,
  // and a few rooftop units for texture (deterministic by tile index).
  const ids = blockIds(cfg)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x
    if (cells[k] !== Cell.Wall) continue
    ctx.fillStyle = PALETTE.roofs[ids[k] % PALETTE.roofs.length]
    ctx.fillRect(x * tile, y * tile, tile, tile)
    if ((k * 2654435761) % 7 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(x * tile + tile * 0.3, y * tile + tile * 0.3, tile * 0.35, tile * 0.25)
    }
  }
  ctx.strokeStyle = PALETTE.roofEdge
  ctx.lineWidth = Math.max(1, tile / 8)
  ctx.beginPath()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (open(x, y)) continue
    const px = x * tile, py = y * tile
    if (open(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + tile, py) }
    if (open(x, y + 1)) { ctx.moveTo(px, py + tile); ctx.lineTo(px + tile, py + tile) }
    if (open(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + tile) }
    if (open(x + 1, y)) { ctx.moveTo(px + tile, py); ctx.lineTo(px + tile, py + tile) }
  }
  ctx.stroke()

  // Lane dashes on straight road; crosswalk stripes where a road meets a junction.
  ctx.lineWidth = Math.max(1, tile / 14)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!open(x, y)) continue
    const lr = open(x - 1, y) || open(x + 1, y)
    const ud = open(x, y - 1) || open(x, y + 1)
    const junction = [open(x - 1, y), open(x + 1, y), open(x, y - 1), open(x, y + 1)].filter(Boolean).length >= 3
    const cx = (x + 0.5) * tile, cy = (y + 0.5) * tile
    if (junction) {
      ctx.fillStyle = PALETTE.crosswalk
      for (let i = 0; i < 3; i++) {
        const o = tile * (0.2 + i * 0.25)
        if (open(x, y - 1)) ctx.fillRect(x * tile + o, y * tile, tile * 0.12, tile * 0.16)
        if (open(x, y + 1)) ctx.fillRect(x * tile + o, (y + 1) * tile - tile * 0.16, tile * 0.12, tile * 0.16)
        if (open(x - 1, y)) ctx.fillRect(x * tile, y * tile + o, tile * 0.16, tile * 0.12)
        if (open(x + 1, y)) ctx.fillRect((x + 1) * tile - tile * 0.16, y * tile + o, tile * 0.16, tile * 0.12)
      }
      continue
    }
    ctx.strokeStyle = PALETTE.laneMark
    ctx.beginPath()
    if (lr && !ud) { ctx.moveTo(cx - tile * 0.25, cy); ctx.lineTo(cx + tile * 0.25, cy) }
    if (ud && !lr) { ctx.moveTo(cx, cy - tile * 0.25); ctx.lineTo(cx, cy + tile * 0.25) }
    ctx.stroke()
  }

  staticCache.set(cfg, { tile, dpr, canvas })
  return canvas
}

// ─── Sprites ────────────────────────────────────────────────────────────────

function car(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: Dir, tile: number,
  body: string, hood: string, alpha = 1,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(cx, cy)
  ctx.rotate(ANGLE[dir === Dir.None ? Dir.Up : dir])
  const L = tile * 0.9, W = tile * 0.56
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath(); ctx.roundRect(-L / 2 + 1.5, -W / 2 + 1.5, L, W, W * 0.3); ctx.fill()
  ctx.fillStyle = body
  ctx.beginPath(); ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.3); ctx.fill()
  ctx.fillStyle = hood
  ctx.fillRect(L * 0.08, -W * 0.36, L * 0.22, W * 0.72) // windshield
  ctx.fillRect(-L * 0.38, -W * 0.32, L * 0.14, W * 0.64) // rear window
  ctx.fillStyle = '#fff6c8'
  ctx.fillRect(L / 2 - 2, -W / 2 + 1.5, 2, W * 0.22) // headlights
  ctx.fillRect(L / 2 - 2, W / 2 - 1.5 - W * 0.22, 2, W * 0.22)
  ctx.restore()
}

function sirenBar(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: Dir, tile: number, on: boolean, timeMs: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(ANGLE[dir === Dir.None ? Dir.Up : dir])
  const flip = Math.floor(timeMs / 140) % 2 === 0
  const W = tile * 0.56
  ctx.fillStyle = on ? (flip ? PALETTE.sirenRed : PALETTE.sirenBlue) : '#7a1f28'
  ctx.fillRect(-tile * 0.06, -W * 0.42, tile * 0.1, W * 0.42)
  ctx.fillStyle = on ? (flip ? PALETTE.sirenBlue : PALETTE.sirenRed) : '#1f3a7a'
  ctx.fillRect(-tile * 0.06, 0, tile * 0.1, W * 0.42)
  if (on) {
    ctx.globalAlpha = 0.35
    ctx.fillStyle = flip ? PALETTE.sirenRed : PALETTE.sirenBlue
    ctx.beginPath(); ctx.arc(0, 0, tile * 0.9, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

function lootIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, pulse: number) {
  const r = tile * 0.32 * pulse
  ctx.save()
  ctx.shadowColor = PALETTE.loot
  ctx.shadowBlur = tile * 0.8
  ctx.fillStyle = PALETTE.loot
  ctx.beginPath() // a cut gem
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy - r * 0.2); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy - r * 0.2)
  ctx.closePath(); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.2); ctx.lineTo(cx - r * 0.4, cy - r * 0.2); ctx.closePath(); ctx.fill()
  ctx.restore()
}

function smokeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number) {
  ctx.save()
  ctx.fillStyle = PALETTE.smoke
  ctx.beginPath(); ctx.roundRect(cx - tile * 0.14, cy - tile * 0.26, tile * 0.28, tile * 0.52, tile * 0.08); ctx.fill()
  ctx.fillStyle = '#3dff9a'
  ctx.fillRect(cx - tile * 0.14, cy - tile * 0.06, tile * 0.28, tile * 0.1)
  ctx.restore()
}

function smokeCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, timeMs: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(200, 205, 215, 0.35)'
  for (let i = 0; i < 5; i++) {
    const a = timeMs / 700 + i * 1.3
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * tile * 0.35, cy + Math.sin(a) * tile * 0.3, tile * 0.38, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function safehouse(ctx: CanvasRenderingContext2D, x: number, y: number, tile: number, open: boolean, timeMs: number) {
  const cx = (x + 0.5) * tile, cy = (y + 0.5) * tile
  ctx.save()
  const color = open ? PALETTE.exitOpen : PALETTE.exitLocked
  if (open) {
    const ring = (timeMs / 900) % 1
    ctx.strokeStyle = color
    ctx.globalAlpha = 1 - ring
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(cx, cy, tile * (0.5 + ring * 1.2), 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.shadowColor = color; ctx.shadowBlur = tile
  }
  ctx.fillStyle = color
  ctx.beginPath(); ctx.roundRect(cx - tile * 0.42, cy - tile * 0.42, tile * 0.84, tile * 0.84, tile * 0.12); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#0b0d12'
  ctx.font = `bold ${Math.round(tile * 0.55)}px system-ui, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(open ? 'H' : '🔒', cx, cy + 1)
  ctx.restore()
}

// ─── Frame ──────────────────────────────────────────────────────────────────

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
  ctx.drawImage(staticLayer(cfg, tile, dpr), 0, 0, w * tile, h * tile)

  // Headlight beams first, so cars draw on top. Red when chasing you.
  s.cops.forEach((c: CopState) => {
    if (c.status === 'garage' || c.status === 'blind') return
    ctx.fillStyle = c.status === 'chase' ? PALETTE.beamChase : PALETTE.beam
    for (const t of beamTiles(cfg.maze, c.x, c.y, c.dir, cfg.modifiers.copVision)) {
      ctx.fillRect(t.x * tile + tile * 0.12, t.y * tile + tile * 0.12, tile * 0.76, tile * 0.76)
    }
  })

  safehouse(ctx, s.exit.x, s.exit.y, tile, s.exit.open, timeMs)
  const pulse = 0.85 + 0.15 * Math.sin(timeMs / 220)
  for (const l of s.loot) if (!l.taken) lootIcon(ctx, (l.x + 0.5) * tile, (l.y + 0.5) * tile, tile, pulse)
  for (const b of s.smokes) if (!b.taken) smokeIcon(ctx, (b.x + 0.5) * tile, (b.y + 0.5) * tile, tile)

  // Police cars.
  s.cops.forEach((c, i) => {
    const p = pos[i + 1] ?? c
    const cx = (p.x + 0.5) * tile, cy = (p.y + 0.5) * tile
    const parked = c.status === 'garage'
    car(ctx, cx, cy, c.dir, tile, PALETTE.copBody, PALETTE.copHood, parked ? 0.55 : 1)
    sirenBar(ctx, cx, cy, c.dir, tile, c.status === 'chase' || c.status === 'search', timeMs)
    if (c.status === 'blind') smokeCloud(ctx, cx, cy, tile, timeMs)
  })

  // Getaway car.
  const pp = pos[0] ?? s.player
  const px = (pp.x + 0.5) * tile, py = (pp.y + 0.5) * tile
  ctx.save()
  ctx.shadowColor = PALETTE.getaway
  ctx.shadowBlur = tile * 0.6
  car(ctx, px, py, predictNextDir(cfg.maze, s) || s.player.dir, tile, PALETTE.getaway, '#2a1606')
  ctx.restore()

  // Last-seen marker: where the cops think you are.
  if (s.lastSeen && s.cops.some((c) => c.status === 'search')) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 80, 90, 0.7)'
    ctx.setLineDash([3, 3])
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc((s.lastSeen.x + 0.5) * tile, (s.lastSeen.y + 0.5) * tile, tile * 0.6, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  // Night: only a circle around you stays visible (headlights still show).
  const vision = cfg.modifiers.visionRadius
  if (vision !== null) {
    const g = ctx.createRadialGradient(px, py, tile * (vision - 1.5), px, py, tile * vision)
    g.addColorStop(0, 'rgba(5,6,10,0)')
    g.addColorStop(1, 'rgba(5,6,10,0.9)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w * tile, h * tile)
  }
  ctx.restore()
}
