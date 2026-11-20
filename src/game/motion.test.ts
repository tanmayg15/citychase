import { describe, expect, it } from 'vitest'
import { CLEAR_WEATHER, DEFAULT_PLAN, Dir, PLAYER_PERIOD, createGame, parseMaze, step, weatherToModifiers } from '../engine'
import { TEST_MAZE_ROWS } from '../engine/fixtures'
import { Motion } from './motion'

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

describe('player drawn with no lag (turns happen where they look like they should)', () => {
  const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 1, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }

  it('when the engine has just arrived on a tile, the car is drawn exactly on it', () => {
    const s = createGame(cfg)
    s.cops = []
    const m = new Motion(s)
    step(cfg, s, Dir.Right)
    while (s.player.clock !== 0 || s.player.x === 9) { step(cfg, s); m.update(s) }
    const drawn = m.player(cfg.maze, s, 0)
    expect(drawn.x).toBeCloseTo(s.player.x, 1)
    expect(drawn.y).toBeCloseTo(s.player.y, 1)
  })

  it('pressing a turn while the car is drawn at a junction turns at THAT junction', () => {
    // Drive right until the engine sits on a junction with an open street upward,
    // then press Up while the car is drawn there.
    const s = createGame(cfg)
    s.cops = []
    const m = new Motion(s)
    step(cfg, s, Dir.Right); m.update(s)
    let guard = 0
    // Advance until the engine sits on a tile from which Up is possible (a junction).
    while (!(s.player.clock === 0 && s.player.x !== 9 && canMoveUp(s)) && guard++ < 200) { step(cfg, s); m.update(s) }
    const junction = { x: s.player.x, y: s.player.y }
    // Drawn at the junction now; the player presses Up mid-way through the tile time.
    step(cfg, s, Dir.Up); m.update(s)
    expect(m.player(cfg.maze, s, 0.5).y).toBeLessThan(junction.y) // drawn heading up already
    for (let i = 0; i < PLAYER_PERIOD; i++) { step(cfg, s); m.update(s) }
    expect({ x: s.player.x, y: s.player.y }).toEqual({ x: junction.x, y: junction.y - 1 }) // turned here, not later
  })

  function canMoveUp(s: ReturnType<typeof createGame>) {
    const k = (s.player.y - 1) * cfg.maze.width + s.player.x
    return cfg.maze.cells[k] !== 1
  }
})
