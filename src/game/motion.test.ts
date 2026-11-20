import { describe, expect, it } from 'vitest'
import { CLEAR_WEATHER, DEFAULT_PLAN, Dir, PLAYER_PERIOD, createGame, parseMaze, step, weatherToModifiers } from '../engine'
import { TEST_MAZE_ROWS } from '../engine/fixtures'
import { Motion, shouldHoldTurn } from './motion'

describe('Motion', () => {
  it('moves the runner at a constant visual speed (no hop-and-pause)', () => {
    const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 1, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }
    const s = createGame(cfg)
    const m = new Motion(s)
    step(cfg, s, Dir.Left); m.update(s)
    const xs: number[] = []
    // Sample 4 frames per tick for 5 moves' worth of ticks once moving.
    for (let t = 0; t < PLAYER_PERIOD * 6; t++) {
      for (const a of [0, 0.25, 0.5, 0.75]) xs.push(m.sample(s, a)[0].x)
      step(cfg, s); m.update(s)
    }
    const moving = xs.slice(PLAYER_PERIOD * 4) // skip the start-up before the first move
    const deltas = moving.slice(1).map((x, i) => +(moving[i] - x).toFixed(6))
    const expected = 1 / (PLAYER_PERIOD * 4) // one tile per PLAYER_PERIOD ticks, 4 samples per tick
    for (const d of deltas) expect(d).toBeCloseTo(expected, 5)
  })
})

describe('junction timing: at the junction vs already passed it', () => {
  const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 1, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }

  /** Drive right from the start until the engine has just arrived on a junction with an open street upward. */
  function atJunction() {
    const s = createGame(cfg)
    s.cops = []
    const m = new Motion(s)
    step(cfg, s, Dir.Right); m.update(s)
    let guard = 0
    while (!(s.player.clock === 0 && s.player.x !== 9 && cfg.maze.cells[(s.player.y - 1) * cfg.maze.width + s.player.x] !== 1) && guard++ < 200) {
      step(cfg, s); m.update(s)
    }
    return { s, m, junction: { x: s.player.x, y: s.player.y } }
  }

  /** The game loop's rule: feed a key to the engine unless it must be held. */
  function tick(s: ReturnType<typeof createGame>, pending: { dir: Dir }) {
    if (pending.dir !== Dir.None && !shouldHoldTurn(cfg.maze, s, pending.dir)) { step(cfg, s, pending.dir); pending.dir = Dir.None } else step(cfg, s)
  }

  it('the car is drawn at the junction centre halfway through its time there', () => {
    const { s, m, junction } = atJunction()
    const arriving = m.player(cfg.maze, s, 0)
    expect(arriving.x).toBeCloseTo(junction.x - 0.5, 1) // still approaching
    step(cfg, s); step(cfg, s) // clock = 2 = half of PLAYER_PERIOD
    for (let i = 0; i < 6; i++) m.player(cfg.maze, s, 0) // let smoothing settle
    const centre = m.player(cfg.maze, s, 0)
    expect(centre.x).toBeCloseTo(junction.x, 1)
    expect(centre.y).toBeCloseTo(junction.y, 1)
  })

  it('a turn pressed before the centre is taken at this junction', () => {
    const { s, junction } = atJunction()
    const pending = { dir: Dir.Up }
    for (let i = 0; i < PLAYER_PERIOD + 1; i++) tick(s, pending)
    expect({ x: s.player.x, y: s.player.y }).toEqual({ x: junction.x, y: junction.y - 1 })
  })

  it('a turn pressed after the car passed the centre is NOT taken here', () => {
    const { s, junction } = atJunction()
    step(cfg, s); step(cfg, s) // past the centre (clock = 2)
    expect(shouldHoldTurn(cfg.maze, s, Dir.Up)).toBe(true)
    const pending = { dir: Dir.Up }
    for (let i = 0; i < PLAYER_PERIOD; i++) tick(s, pending)
    expect(s.player.y).toBe(junction.y) // kept going straight
    expect(s.player.x).toBe(junction.x + 1)
  })

  it('reversing is never held', () => {
    const { s } = atJunction()
    step(cfg, s); step(cfg, s)
    expect(shouldHoldTurn(cfg.maze, s, Dir.Left)).toBe(false)
  })
})

describe('a parked car does not shake', () => {
  it('a car blocked by a wall is drawn still, every frame', () => {
    const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 1, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }
    const s = createGame(cfg)
    s.cops = []
    const m = new Motion(s)
    step(cfg, s, Dir.Down); m.update(s) // (9,12) is a wall: the car never moves
    const xs: number[] = [], ys: number[] = []
    for (let i = 0; i < PLAYER_PERIOD * 5; i++) {
      for (const a of [0, 0.5]) { const p = m.player(cfg.maze, s, a); xs.push(p.x); ys.push(p.y) }
      step(cfg, s); m.update(s)
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01)
  })
})
