/**
 * City Chase deterministic heist engine.
 *
 * You drive the getaway car: grab loot, reach the safehouse once it opens,
 * and don't get caught. Cops patrol, spot you by line of sight down a street,
 * chase, radio your last-seen spot, then search it. Smoke bombs blind them.
 *
 * Rules for this file (they keep browser and server replays identical):
 *  - integer math only; no Math.random, Date.now, or float accumulation
 *  - all randomness from the seeded RNG stored in GameState
 *  - fixed tick rate; pieces move one whole tile every N ticks
 */
import { canMove, isOpen, REVERSE, stepPoint } from './maze'
import { rngInt, seedFromString } from './rng'
import {
  Cell, Dir, Gadget, GADGET_KINDS,
  type CopState, type GadgetKind, type Input, type GameConfig, type GameState, type InputLog, type Loot, type Maze, type Point,
} from './types'

export const TICK_RATE = 20
export const MAX_TICKS = 3 * 60 * TICK_RATE // runs are capped at 3 minutes
export const MAX_INPUTS = 4000
export const START_LIVES = 3
/** Bump when rules change: stored with each run so old replays can be told apart. */
export const ENGINE_VERSION = 5
/**
 * Can a run recorded under an older engine version be replayed here move for
 * move (used to let older top runs race as ghosts)? Each version's change and
 * the runs it cannot affect:
 *  - v3 added gadgets (inputs 5-7) and crates: no effect on v2 logs.
 *  - v4 made a disguised car uncatchable: no effect if the disguise was never used.
 *  - v5 made fog ('mist') shorten cop sight: no effect on runs in other weather.
 */
export function isReplayable(version: number, log: ReadonlyArray<readonly [number, number]>, condition: string): boolean {
  if (version === ENGINE_VERSION) return true
  if (version < 2 || version > ENGINE_VERSION) return false
  if (condition === 'mist') return false // v5
  if (version === 3 && log.some(([, input]) => input === Gadget.Disguise)) return false // v4
  return true
}

export const PLAYER_PERIOD = 4 // ticks per tile (5 tiles/s)
export const PATROL_PERIOD = 5
export const CHASE_PERIOD = 4
export const SEARCH_PERIOD = 5
export const BLIND_PERIOD = 9
export const CAUGHT_PAUSE = 40
export const SEARCH_TICKS = 120 // how long cops comb the last-seen area
export const RADIO_RANGE = 12 // tiles (Manhattan) a spotting call reaches

export const LOOT_COUNT = 10
export const LOOT_TO_OPEN_EXIT = 7
export const SMOKE_RADIUS = 7
export const ESCAPE_BONUS = 1000
/** Gadgets. */
export const NITRO_TICKS = 60 // 3 s at double speed
export const NITRO_PERIOD = 2
export const OIL_TICKS = 400 // a slick lasts 20 s
export const OIL_SPIN = 80 // a cop that hits it is out for 4 s
export const MAX_OILS = 3
export const DISGUISE_TICKS = 100 // 5 s unseen and uncatchable
export const CRATE_COUNT = 3
/** Every this many ticks of being seen costs 1 point. */
export const HEAT_PER_POINT = 4

/** Tie-break order when cops pick a direction. */
const DIR_ORDER: Dir[] = [Dir.Up, Dir.Left, Dir.Down, Dir.Right]

// ─── Map analysis (deterministic, from the maze only) ───────────────────────

function exits(m: Maze, x: number, y: number): number {
  let n = 0
  for (const d of DIR_ORDER) if (canMove(m, x, y, d)) n++
  return n
}

/** BFS distances (in tiles) from `from` over open tiles. -1 = unreachable. */
export function bfs(m: Maze, from: Point): number[] {
  const dist = new Array(m.width * m.height).fill(-1)
  const q = [from.y * m.width + from.x]
  dist[q[0]] = 0
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % m.width, y = Math.floor(q[h] / m.width)
    for (const d of DIR_ORDER) {
      const n = stepPoint(m, x, y, d)
      const k = n.y * m.width + n.x
      if (dist[k] === -1 && isOpen(m, n.x, n.y)) { dist[k] = dist[q[h]] + 1; q.push(k) }
    }
  }
  return dist
}

/**
 * Safehouse = the junction farthest (by road) from the start. Loot = up to
 * LOOT_COUNT junctions spread out by farthest-point sampling, worth more the
 * farther they are from the start. Same for every player on a given maze.
 */
export function planHeist(m: Maze): { exit: Point; loot: Loot[]; crates: Point[] } {
  const fromStart = bfs(m, m.playerSpawn)
  const garage = m.ghostSpawns.map((g) => bfs(m, g))
  const junctions: number[] = []
  for (let k = 0; k < m.cells.length; k++) {
    const x = k % m.width, y = Math.floor(k / m.width)
    if (!isOpen(m, x, y) || fromStart[k] < 5) continue
    if (garage.some((d) => d[k] >= 0 && d[k] < 3)) continue
    if (m.cells[k] === Cell.Core) continue // smoke spot
    if (exits(m, x, y) >= 3) junctions.push(k)
  }
  const at = (k: number): Point => ({ x: k % m.width, y: Math.floor(k / m.width) })

  let exitK = junctions[0] ?? m.playerSpawn.y * m.width + m.playerSpawn.x
  for (const k of junctions) if (fromStart[k] > fromStart[exitK]) exitK = k

  const fromExit = bfs(m, at(exitK))
  const nearest = new Map<number, number>()
  for (const k of junctions) if (k !== exitK) nearest.set(k, Math.min(fromStart[k], fromExit[k]))
  const chosen: number[] = []
  while (chosen.length < LOOT_COUNT) {
    let best = -1, bestD = -1
    for (const [k, d] of nearest) if (d > bestD) { best = k; bestD = d }
    if (best < 0 || bestD < 3) break
    chosen.push(best)
    nearest.delete(best)
    const fromBest = bfs(m, at(best))
    for (const [k, d] of nearest) nearest.set(k, Math.min(d, fromBest[k]))
  }
  // Gadget crates: the next-most-spread-out junctions after the loot.
  const crates: number[] = []
  while (crates.length < CRATE_COUNT) {
    let best = -1, bestD = -1
    for (const [k, d] of nearest) if (d > bestD) { best = k; bestD = d }
    if (best < 0 || bestD < 2) break
    crates.push(best)
    nearest.delete(best)
    const fromBest = bfs(m, at(best))
    for (const [k, d] of nearest) nearest.set(k, Math.min(d, fromBest[k]))
  }
  chosen.sort((a, b) => a - b)
  crates.sort((a, b) => a - b)
  return {
    crates: crates.map(at),
    exit: at(exitK),
    loot: chosen.map((k) => ({ ...at(k), value: 100 + 50 * Math.floor(fromStart[k] / 4), taken: false })),
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

function spawnCops(cfg: GameConfig, s: { rng: number }, fromTick: number): CopState[] {
  return cfg.plan.cops.map((mode, i) => {
    const home = cfg.maze.ghostSpawns[i % cfg.maze.ghostSpawns.length]
    const [jitter, rng] = rngInt(s.rng, 40)
    s.rng = rng
    const cop: CopState = {
      x: home.x, y: home.y, dir: Dir.Up, mode, status: 'garage',
      releaseTick: fromTick + 20 + i * 40 + jitter,
      homeX: home.x, homeY: home.y, tx: home.x, ty: home.y,
      patrolIdx: i, until: 0, clock: 0, windClock: 0,
    }
    return cop
  })
}

export function createGame(cfg: GameConfig): GameState {
  const holder = { rng: cfg.seed >>> 0 }
  const cops = spawnCops(cfg, holder, 0)
  const heist = planHeist(cfg.maze)
  const smokes = []
  for (let k = 0; k < cfg.maze.cells.length; k++) {
    if (cfg.maze.cells[k] === Cell.Core) {
      smokes.push({ x: k % cfg.maze.width, y: Math.floor(k / cfg.maze.width), taken: false })
    }
  }
  return {
    tick: 0,
    rng: holder.rng,
    status: 'playing',
    score: 0,
    lootScore: 0,
    lootTaken: 0,
    lives: START_LIVES,
    loot: heist.loot,
    smokes,
    exit: { ...heist.exit, open: false },
    heat: 0,
    lastSeen: null,
    player: {
      x: cfg.maze.playerSpawn.x, y: cfg.maze.playerSpawn.y,
      dir: Dir.None, wanted: Dir.None, slip: 0, clock: 0,
    },
    cops,
    pauseUntil: 0,
    gadgets: { nitro: 1, oil: 1, disguise: 1 },
    crates: heist.crates.map((c, i) => ({ ...c, taken: false, kind: GADGET_KINDS[i % GADGET_KINDS.length] })),
    oils: [],
    nitroUntil: 0,
    disguiseUntil: 0,
    events: [],
  }
}

export function playerPeriod(s: GameState): number {
  return s.tick < s.nitroUntil ? NITRO_PERIOD : PLAYER_PERIOD
}

const GADGET_OF: Record<number, GadgetKind> = { [Gadget.Nitro]: 'nitro', [Gadget.Oil]: 'oil', [Gadget.Disguise]: 'disguise' }

function activateGadget(s: GameState, g: Gadget): void {
  const kind = GADGET_OF[g]
  if (!kind || s.gadgets[kind] <= 0) return
  const p = s.player
  if (kind === 'oil' && (s.oils.length >= MAX_OILS || s.oils.some((o) => o.x === p.x && o.y === p.y))) return
  s.gadgets[kind]--
  if (kind === 'nitro') s.nitroUntil = s.tick + NITRO_TICKS
  if (kind === 'oil') s.oils.push({ x: p.x, y: p.y, until: s.tick + OIL_TICKS })
  if (kind === 'disguise') {
    s.disguiseUntil = s.tick + DISGUISE_TICKS
    for (const c of s.cops) {
      if (c.status === 'chase') {
        c.status = 'search'
        c.tx = s.lastSeen?.x ?? p.x
        c.ty = s.lastSeen?.y ?? p.y
        c.until = s.tick + SEARCH_TICKS
      }
    }
  }
  s.events.push({ type: 'gadget', kind })
}

export function scoreOf(s: GameState): number {
  const escape = s.status === 'escaped' ? ESCAPE_BONUS + ((MAX_TICKS - s.tick) >> 1) : 0
  return Math.max(0, s.lootScore + escape - Math.floor(s.heat / HEAT_PER_POINT))
}

// ─── Vision ─────────────────────────────────────────────────────────────────

/**
 * True if a cop at (cx,cy) facing `dir` can see (px,py): right next to it in any
 * direction, or straight ahead down the same street (headlights) within
 * `range`, with no building in between. You can sneak up behind a cop.
 */
export function canSee(m: Maze, cx: number, cy: number, dir: Dir, px: number, py: number, range: number): boolean {
  const dx = px - cx, dy = py - cy
  if (Math.abs(dx) + Math.abs(dy) <= 1) return true
  if (dx !== 0 && dy !== 0) return false
  const sx = Math.sign(dx), sy = Math.sign(dy)
  const facing = [0, 0, 1, 0, -1][dir] === sx && [0, -1, 0, 1, 0][dir] === sy
  if (!facing) return false
  const n = Math.abs(dx + dy)
  if (n > range) return false
  for (let i = 1; i < n; i++) if (!isOpen(m, cx + sx * i, cy + sy * i)) return false
  return true
}

/** Tiles a cop's headlights currently light up (for rendering the beam). */
export function beamTiles(m: Maze, cx: number, cy: number, dir: Dir, range: number): Point[] {
  const out: Point[] = []
  if (dir === Dir.None) return out
  const sx = [0, 0, 1, 0, -1][dir], sy = [0, -1, 0, 1, 0][dir]
  for (let i = 1; i <= range; i++) {
    const x = cx + sx * i, y = cy + sy * i
    if (x < 0 || y < 0 || x >= m.width || y >= m.height || !isOpen(m, x, y)) break
    out.push({ x, y })
  }
  return out
}

// ─── Cops ───────────────────────────────────────────────────────────────────

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return dx * dx + dy * dy
}

function randomJunction(cfg: GameConfig, s: GameState): Point {
  const m = cfg.maze
  for (let tries = 0; tries < 40; tries++) {
    const [k, rng] = rngInt(s.rng, m.cells.length)
    s.rng = rng
    const x = k % m.width, y = Math.floor(k / m.width)
    if (isOpen(m, x, y) && exits(m, x, y) >= 3) return { x, y }
  }
  return { ...m.playerSpawn }
}

function randomJunctionNear(cfg: GameConfig, s: GameState, p: Point, r: number): Point {
  for (let tries = 0; tries < 20; tries++) {
    const j = randomJunction(cfg, s)
    if (Math.abs(j.x - p.x) + Math.abs(j.y - p.y) <= r) return j
  }
  return { x: p.x, y: p.y }
}

/** Pick a new patrol destination for a cop, from its commander-assigned mode. */
function nextPatrolTarget(cfg: GameConfig, s: GameState, c: CopState): Point {
  switch (c.mode) {
    case 'guardLoot': {
      const left = s.loot.filter((l) => !l.taken)
      if (left.length === 0) return { x: s.exit.x, y: s.exit.y }
      c.patrolIdx = (c.patrolIdx + 1) % left.length
      return { x: left[c.patrolIdx].x, y: left[c.patrolIdx].y }
    }
    case 'guardExit':
      // Circle the safehouse: alternate between it and a nearby junction.
      c.patrolIdx++
      return c.patrolIdx % 2 ? { x: s.exit.x, y: s.exit.y } : randomJunctionNear(cfg, s, s.exit, 6)
    case 'patrol': {
      const chokes = cfg.plan.chokepoints
      if (chokes.length === 0) return randomJunction(cfg, s)
      c.patrolIdx = (c.patrolIdx + 1) % chokes.length
      return chokes[c.patrolIdx]
    }
    case 'roam':
      return randomJunction(cfg, s)
  }
  return randomJunction(cfg, s)
}

function chooseDir(cfg: GameConfig, s: GameState, c: CopState, wander: boolean): Dir {
  const options = DIR_ORDER.filter((d) => d !== REVERSE[c.dir] && canMove(cfg.maze, c.x, c.y, d))
  if (options.length === 0) return REVERSE[c.dir] // dead end: turn back
  if (wander) {
    const [k, rng] = rngInt(s.rng, options.length)
    s.rng = rng
    return options[k]
  }
  const t = { x: c.tx, y: c.ty }
  let best = options[0], bestD = Infinity
  for (const d of options) {
    const dd = dist2(stepPoint(cfg.maze, c.x, c.y, d), t)
    if (dd < bestD) { best = d; bestD = dd }
  }
  return best
}

export function copPeriod(c: CopState): number {
  switch (c.status) {
    case 'chase': return CHASE_PERIOD
    case 'search': return SEARCH_PERIOD
    case 'blind': return BLIND_PERIOD
    default: return PATROL_PERIOD
  }
}

/** Vision pass: who sees the player this tick; a sighting radios nearby units. */
function updateVision(cfg: GameConfig, s: GameState): void {
  const p = s.player
  let seen = false
  const disguised = s.tick < s.disguiseUntil
  s.cops.forEach((c, i) => {
    if (c.status === 'garage' || c.status === 'blind') return
    if (disguised || !canSee(cfg.maze, c.x, c.y, c.dir, p.x, p.y, cfg.modifiers.copVision)) {
      if (c.status === 'chase') {
        // Lost sight: drive to where you were last seen and search there.
        c.status = 'search'
        c.tx = s.lastSeen?.x ?? p.x
        c.ty = s.lastSeen?.y ?? p.y
        c.until = s.tick + SEARCH_TICKS
      }
      return
    }
    seen = true
    if (c.status !== 'chase') s.events.push({ type: 'spotted', cop: i })
    c.status = 'chase'
    c.tx = p.x
    c.ty = p.y
  })
  if (!seen) return
  s.heat++
  s.lastSeen = { x: p.x, y: p.y }
  // Radio call: patrolling units in range head for the sighting.
  for (const c of s.cops) {
    if (c.status === 'patrol' && Math.abs(c.x - p.x) + Math.abs(c.y - p.y) <= RADIO_RANGE) {
      c.status = 'search'
      c.tx = p.x
      c.ty = p.y
      c.until = s.tick + SEARCH_TICKS
    }
  }
}

function moveCop(cfg: GameConfig, s: GameState, c: CopState): void {
  if (c.status === 'blind' && s.tick >= c.until) {
    c.status = 'search'
    c.until = s.tick + SEARCH_TICKS
  }
  if (c.status === 'search' && s.tick >= c.until) c.status = 'patrol'

  const atTarget = c.x === c.tx && c.y === c.ty
  if (c.status === 'patrol' && atTarget) {
    const t = nextPatrolTarget(cfg, s, c)
    c.tx = t.x
    c.ty = t.y
  }
  // Blinded cops, and searchers who reached the spot, drive around at random.
  const wander = c.status === 'blind' || (c.status === 'search' && atTarget)
  c.dir = chooseDir(cfg, s, c, wander)
  const n = stepPoint(cfg.maze, c.x, c.y, c.dir)
  c.x = n.x
  c.y = n.y

  hitOil(s, c)

  const wind = cfg.modifiers.wind
  if (wind && (c.status === 'patrol' || c.status === 'search')) {
    c.windClock++
    if (c.windClock >= wind.every) {
      c.windClock = 0
      if (canMove(cfg.maze, c.x, c.y, wind.dir)) {
        const w = stepPoint(cfg.maze, c.x, c.y, wind.dir)
        c.x = w.x
        c.y = w.y
        hitOil(s, c)
      }
    }
  }
}

/** A cop driving onto an oil slick spins out (blind) and the slick is used up. */
function hitOil(s: GameState, c: CopState): void {
  if (c.status === 'blind') return
  const k = s.oils.findIndex((o) => o.x === c.x && o.y === c.y)
  if (k < 0) return
  s.oils.splice(k, 1)
  c.status = 'blind'
  c.until = s.tick + OIL_SPIN
  s.events.push({ type: 'spinout', cop: s.cops.indexOf(c) })
}

// ─── Player ─────────────────────────────────────────────────────────────────

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

  for (const l of s.loot) {
    if (!l.taken && l.x === p.x && l.y === p.y) {
      l.taken = true
      s.lootScore += l.value
      s.lootTaken++
      s.events.push({ type: 'loot', value: l.value })
      if (!s.exit.open && s.lootTaken >= Math.min(LOOT_TO_OPEN_EXIT, s.loot.length)) {
        s.exit.open = true
        s.events.push({ type: 'exitOpen' })
      }
    }
  }
  for (const b of s.smokes) {
    if (!b.taken && b.x === p.x && b.y === p.y) {
      b.taken = true
      let blinded = 0
      for (const c of s.cops) {
        if (c.status !== 'garage' && Math.abs(c.x - p.x) + Math.abs(c.y - p.y) <= SMOKE_RADIUS) {
          c.status = 'blind'
          c.until = s.tick + cfg.modifiers.powerTicks
          blinded++
        }
      }
      s.events.push({ type: 'smoke', blinded })
    }
  }
  for (const b of s.crates) {
    if (!b.taken && b.x === p.x && b.y === p.y) {
      b.taken = true
      s.gadgets[b.kind]++
      s.events.push({ type: 'crate', kind: b.kind })
    }
  }
  if (s.exit.open && p.x === s.exit.x && p.y === s.exit.y) s.status = 'escaped'
}

/** Returns true if the player was caught (caller stops processing this tick). */
function caught(cfg: GameConfig, s: GameState): boolean {
  const p = s.player
  // Disguised, you can drive straight past (or through) a cop.
  if (s.tick < s.disguiseUntil) return false
  const hit = s.cops.some((c) => c.x === p.x && c.y === p.y && c.status !== 'garage' && c.status !== 'blind')
  if (!hit) return false
  s.lives--
  s.events.push({ type: 'caught', livesLeft: s.lives })
  if (s.lives <= 0) {
    s.status = 'busted'
    return true
  }
  p.x = cfg.maze.playerSpawn.x
  p.y = cfg.maze.playerSpawn.y
  p.dir = Dir.None
  p.wanted = Dir.None
  p.slip = 0
  p.clock = 0
  s.lastSeen = null
  s.nitroUntil = 0
  s.disguiseUntil = 0
  s.oils = []
  s.cops = spawnCops(cfg, s, s.tick + CAUGHT_PAUSE)
  s.pauseUntil = s.tick + CAUGHT_PAUSE
  return true
}

// ─── Tick ───────────────────────────────────────────────────────────────────

/**
 * Advance one tick. `input` is the direction pressed on this tick (Dir.None if
 * nothing new). Mutates and returns `s`.
 */
export function step(cfg: GameConfig, s: GameState, input: Input = Dir.None): GameState {
  if (s.status !== 'playing') return s
  s.events = []
  const p = s.player
  if (s.oils.length) s.oils = s.oils.filter((o) => o.until > s.tick)

  if (input >= Gadget.Nitro) {
    if (s.tick >= s.pauseUntil) activateGadget(s, input as Gadget)
  } else if (input !== Dir.None) {
    const isTurn = p.dir !== Dir.None && input !== p.dir && input !== REVERSE[p.dir]
    p.wanted = input as Dir
    p.slip = isTurn ? cfg.modifiers.slipTiles : 0
  }

  if (s.tick >= s.pauseUntil) {
    let done = false
    p.clock++
    if (p.clock >= playerPeriod(s)) {
      p.clock = 0
      movePlayer(cfg, s)
      done = s.status !== 'playing' || caught(cfg, s)
    }

    for (let i = 0; i < s.cops.length && !done; i++) {
      const c = s.cops[i]
      if (c.status === 'garage') {
        if (s.tick >= c.releaseTick) {
          c.status = 'patrol'
          const t = nextPatrolTarget(cfg, s, c)
          c.tx = t.x
          c.ty = t.y
        }
        continue
      }
      c.clock++
      if (c.clock < copPeriod(c)) continue
      c.clock = 0
      moveCop(cfg, s, c)
      done = caught(cfg, s)
    }
    if (!done) updateVision(cfg, s)
  }

  s.tick++
  if (s.status === 'playing' && s.tick >= MAX_TICKS) s.status = 'timeout'
  s.score = scoreOf(s)
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
    if (!Number.isInteger(d) || d < Dir.Up || d > Gadget.Disguise) return { ok: false, error: `bad input ${d}` }
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
    let input: Input = Dir.None
    if (k < log.length && log[k][0] === s.tick) input = log[k++][1]
    step(cfg, s, input)
  }
  return s
}
