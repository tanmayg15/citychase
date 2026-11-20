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
