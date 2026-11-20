/**
 * City Chase deterministic engine.
 *
 * Rules for this file (they keep browser and server replays identical):
 *  - integer math only; no Math.random, Date.now, or float accumulation
 *  - all randomness from the seeded RNG stored in GameState
 *  - fixed tick rate; entities move one whole tile every N ticks
 */
import { canMove, REVERSE, stepPoint } from './maze'
import { rngInt, seedFromString } from './rng'
import {
  Cell, Dir,
  type GameConfig, type GameState, type GhostState, type InputLog, type Point,
} from './types'

export const TICK_RATE = 20
export const MAX_TICKS = 3 * 60 * TICK_RATE // runs are capped at 3 minutes
export const MAX_INPUTS = 4000
export const START_LIVES = 3

export const PLAYER_PERIOD = 4 // ticks per tile (5 tiles/s)
export const GHOST_PERIOD = 5
export const FRIGHTENED_PERIOD = 8
export const EATEN_PERIOD = 2
export const DEATH_PAUSE = 40
export const GHOST_RESPAWN = 40
export const SCATTER_CYCLE = 400 // every 20 s ...
export const SCATTER_LENGTH = 100 // ... ghosts retreat to corners for 5 s

export const ORB_POINTS = 10
export const CORE_POINTS = 50
export const GHOST_POINTS = 200
export const CLEAR_BONUS = 1000

/** Tie-break order when ghosts pick a direction. */
const GHOST_DIR_ORDER: Dir[] = [Dir.Up, Dir.Left, Dir.Down, Dir.Right]

function countPellets(cells: number[]): number {
  let n = 0
  for (const c of cells) if (c === Cell.Orb || c === Cell.Core) n++
  return n
}

function spawnGhosts(cfg: GameConfig, state: { rng: number }, fromTick: number): GhostState[] {
  const ghosts: GhostState[] = []
  for (let i = 0; i < cfg.plan.ghosts.length; i++) {
    const home = cfg.maze.ghostSpawns[i % cfg.maze.ghostSpawns.length]
    const [jitter, rng] = rngInt(state.rng, 40)
    state.rng = rng
    ghosts.push({
      x: home.x, y: home.y, dir: Dir.Up,
      mode: cfg.plan.ghosts[i],
      status: 'house',
      releaseTick: fromTick + i * 60 + jitter,
      homeX: home.x, homeY: home.y,
      patrolIdx: 0, clock: 0, windClock: 0,
    })
  }
  return ghosts
}

export function createGame(cfg: GameConfig): GameState {
  const holder = { rng: cfg.seed >>> 0 }
  const ghosts = spawnGhosts(cfg, holder, 0)
  const cells = [...cfg.maze.cells]
  return {
    tick: 0,
    rng: holder.rng,
    status: 'playing',
    score: 0,
    lives: START_LIVES,
    pelletsLeft: countPellets(cells),
    cells,
    player: {
      x: cfg.maze.playerSpawn.x, y: cfg.maze.playerSpawn.y,
      dir: Dir.None, wanted: Dir.None, slip: 0, clock: 0,
    },
    ghosts,
    powerUntil: 0,
    combo: 0,
    pauseUntil: 0,
    events: [],
  }
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by
  return dx * dx + dy * dy
}

function corner(cfg: GameConfig, i: number): Point {
  const { width: w, height: h } = cfg.maze
  return [{ x: 1, y: 1 }, { x: w - 2, y: 1 }, { x: 1, y: h - 2 }, { x: w - 2, y: h - 2 }][i % 4]
}

/** Where a ghost is heading, from its plan mode. */
function ghostTarget(cfg: GameConfig, s: GameState, g: GhostState, i: number): Point {
  if (g.status === 'eaten') return { x: g.homeX, y: g.homeY }
  if (s.tick % SCATTER_CYCLE < SCATTER_LENGTH) return corner(cfg, i)
  const p = s.player
  const ahead = (n: number): Point => ({
    x: p.x + [0, 0, n, 0, -n][p.dir], y: p.y + [0, -n, 0, n, 0][p.dir],
  })
  const chokes = cfg.plan.chokepoints
  switch (g.mode) {
    case 'chase':
      return { x: p.x, y: p.y }
    case 'ambush':
      return ahead(4)
    case 'patrol': {
      if (chokes.length === 0) return corner(cfg, i)
      const c = chokes[g.patrolIdx % chokes.length]
      if (c.x === g.x && c.y === g.y) g.patrolIdx = (g.patrolIdx + 1) % chokes.length
      return chokes[g.patrolIdx % chokes.length]
    }
    case 'cutoff': {
      if (chokes.length === 0) return ahead(2)
      let best = chokes[0], bestD = Infinity
      for (const c of chokes) {
        const d = Math.abs(c.x - p.x) + Math.abs(c.y - p.y)
        if (d < bestD) { best = c; bestD = d }
      }
      return best
    }
  }
}

function chooseGhostDir(cfg: GameConfig, s: GameState, g: GhostState, i: number): Dir {
  const options = GHOST_DIR_ORDER.filter(
    (d) => d !== REVERSE[g.dir] && canMove(cfg.maze, g.x, g.y, d),
  )
  if (options.length === 0) return REVERSE[g.dir] // dead end: turn back
  if (g.status === 'frightened') {
    const [k, rng] = rngInt(s.rng, options.length)
    s.rng = rng
    return options[k]
  }
  const t = ghostTarget(cfg, s, g, i)
  let best = options[0], bestD = Infinity
  for (const d of options) {
    const n = stepPoint(cfg.maze, g.x, g.y, d)
    const dd = dist2(n.x, n.y, t.x, t.y)
    if (dd < bestD) { best = d; bestD = dd }
  }
  return best
}

function moveGhost(cfg: GameConfig, g: GhostState, dir: Dir): void {
  const n = stepPoint(cfg.maze, g.x, g.y, dir)
  g.x = n.x
  g.y = n.y
}

function movePlayer(cfg: GameConfig, s: GameState): void {
  const p = s.player
  let dir = p.dir
  if (p.wanted !== Dir.None && p.wanted !== p.dir) {
    if (p.slip > 0 && canMove(cfg.maze, p.x, p.y, p.dir)) {
      p.slip--
    } else if (canMove(cfg.maze, p.x, p.y, p.wanted)) {
      dir = p.wanted
      p.slip = 0
    }
  }
  if (!canMove(cfg.maze, p.x, p.y, dir)) return
  p.dir = dir
  const n = stepPoint(cfg.maze, p.x, p.y, dir)
  p.x = n.x
  p.y = n.y

  const idx = p.y * cfg.maze.width + p.x
  const cell = s.cells[idx]
  if (cell === Cell.Orb) {
    s.cells[idx] = Cell.Empty
    s.score += ORB_POINTS
    s.pelletsLeft--
    s.events.push({ type: 'orb' })
  } else if (cell === Cell.Core) {
    s.cells[idx] = Cell.Empty
    s.score += CORE_POINTS
    s.pelletsLeft--
    s.powerUntil = s.tick + cfg.modifiers.powerTicks
    s.combo = 0
    for (const g of s.ghosts) {
      if (g.status === 'active' || g.status === 'frightened') {
        if (g.status === 'active') g.dir = REVERSE[g.dir]
        g.status = 'frightened'
      }
    }
    s.events.push({ type: 'core' })
  }
}

/** Returns true if the player died (caller stops processing this tick). */
function collide(cfg: GameConfig, s: GameState, i: number): boolean {
  const g = s.ghosts[i]
  if (g.x !== s.player.x || g.y !== s.player.y) return false
  if (g.status === 'frightened') {
    const points = GHOST_POINTS << Math.min(s.combo, 3)
    s.score += points
    s.combo++
    g.status = 'eaten'
    s.events.push({ type: 'ghostEaten', ghost: i, points })
    return false
  }
  if (g.status !== 'active') return false

  s.lives--
  s.events.push({ type: 'death', livesLeft: s.lives })
  if (s.lives <= 0) {
    s.status = 'lost'
    return true
  }
  const p = s.player
  p.x = cfg.maze.playerSpawn.x
  p.y = cfg.maze.playerSpawn.y
  p.dir = Dir.None
  p.wanted = Dir.None
  p.slip = 0
  p.clock = 0
  s.powerUntil = 0
  s.combo = 0
  s.ghosts = spawnGhosts(cfg, s, s.tick + DEATH_PAUSE)
  s.pauseUntil = s.tick + DEATH_PAUSE
  return true
}

/**
 * Advance one tick. `input` is the direction pressed on this tick (Dir.None if
 * nothing new). Mutates and returns `s`.
 */
export function step(cfg: GameConfig, s: GameState, input: Dir = Dir.None): GameState {
  if (s.status !== 'playing') return s
  s.events = []
  const p = s.player

  if (input !== Dir.None) {
    const isTurn = p.dir !== Dir.None && input !== p.dir && input !== REVERSE[p.dir]
    p.wanted = input
    p.slip = isTurn ? cfg.modifiers.slipTiles : 0
  }

  if (s.tick >= s.pauseUntil) {
    if (s.powerUntil !== 0 && s.tick >= s.powerUntil) {
      s.powerUntil = 0
      for (const g of s.ghosts) if (g.status === 'frightened') g.status = 'active'
    }

    let died = false
    p.clock++
    if (p.clock >= PLAYER_PERIOD) {
      p.clock = 0
      movePlayer(cfg, s)
      for (let i = 0; i < s.ghosts.length && !died; i++) died = collide(cfg, s, i)
    }

    for (let i = 0; i < s.ghosts.length && !died; i++) {
      const g = s.ghosts[i]
      if (g.status === 'house') {
        if (s.tick >= g.releaseTick) g.status = s.powerUntil ? 'frightened' : 'active'
        continue
      }
      const period = g.status === 'eaten' ? EATEN_PERIOD
        : g.status === 'frightened' ? FRIGHTENED_PERIOD : GHOST_PERIOD
      g.clock++
      if (g.clock < period) continue
      g.clock = 0
      g.dir = chooseGhostDir(cfg, s, g, i)
      moveGhost(cfg, g, g.dir)

      const wind = cfg.modifiers.wind
      if (wind && g.status !== 'eaten') {
        g.windClock++
        if (g.windClock >= wind.every) {
          g.windClock = 0
          if (canMove(cfg.maze, g.x, g.y, wind.dir)) moveGhost(cfg, g, wind.dir)
        }
      }

      if (g.status === 'eaten' && g.x === g.homeX && g.y === g.homeY) {
        g.status = 'house'
        g.releaseTick = s.tick + GHOST_RESPAWN
      }
      died = collide(cfg, s, i)
    }

    if (s.status === 'playing' && s.pelletsLeft === 0) {
      s.status = 'won'
      s.score += CLEAR_BONUS + ((MAX_TICKS - s.tick) >> 1)
    }
  }

  s.tick++
  if (s.status === 'playing' && s.tick >= MAX_TICKS) s.status = 'timeout'
  if (s.status !== 'playing') s.events.push({ type: 'end', status: s.status })
  return s
}

/** Stable hash of everything that affects the game (events excluded). */
export function hashState(s: GameState): string {
  const { events: _events, ...rest } = s
  const text = JSON.stringify(rest)
  return seedFromString(text).toString(16).padStart(8, '0')
}

export type LogCheck = { ok: true } | { ok: false; error: string }

/** Rejects malformed or oversized input logs before any replay work. */
export function validateInputLog(log: unknown): LogCheck {
  if (!Array.isArray(log)) return { ok: false, error: 'inputLog must be an array' }
  if (log.length > MAX_INPUTS) return { ok: false, error: `inputLog longer than ${MAX_INPUTS}` }
  let last = -1
  for (const e of log) {
    if (!Array.isArray(e) || e.length !== 2) return { ok: false, error: 'entry must be [tick, dir]' }
    const [t, d] = e
    if (!Number.isInteger(t) || t < 0 || t >= MAX_TICKS) return { ok: false, error: `bad tick ${t}` }
    if (t <= last) return { ok: false, error: 'ticks must be strictly increasing' }
    if (!Number.isInteger(d) || d < Dir.Up || d > Dir.Left) return { ok: false, error: `bad dir ${d}` }
    last = t
  }
  return { ok: true }
}

/** Replay a full run from its config and input log. Used by the server to score runs. */
export function replay(cfg: GameConfig, log: InputLog): GameState {
  const check = validateInputLog(log)
  if (!check.ok) throw new Error(check.error)
  const s = createGame(cfg)
  let k = 0
  while (s.status === 'playing') {
    let input = Dir.None
    if (k < log.length && log[k][0] === s.tick) input = log[k++][1]
    step(cfg, s, input)
  }
  return s
}
