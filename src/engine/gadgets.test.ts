import { describe, expect, it } from 'vitest'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, DISGUISE_TICKS, Dir, Gadget, NITRO_TICKS, createGame, hashState, parseMaze,
  replay, step, validateInputLog, weatherToModifiers, type InputLog,
} from '.'
import { TEST_MAZE_ROWS } from './fixtures'

const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 7, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }

function ticksToMove(s: ReturnType<typeof createGame>, n: number): number {
  const start = s.player.x
  let t = 0
  while (Math.abs(s.player.x - start) < n && t < 200) { step(cfg, s); t++ }
  return t
}

describe('gadgets', () => {
  it('start with one charge of each and crates on the map', () => {
    const s = createGame(cfg)
    expect(s.gadgets).toEqual({ nitro: 1, oil: 1, disguise: 1 })
    expect(s.crates.length).toBeGreaterThan(0)
  })

  it('nitro doubles speed for a few seconds and uses the charge', () => {
    const a = createGame(cfg); a.cops = []
    step(cfg, a, Dir.Left)
    const normal = ticksToMove(a, 3)
    const b = createGame(cfg); b.cops = []
    step(cfg, b, Dir.Left); step(cfg, b, Gadget.Nitro)
    const fast = ticksToMove(b, 3)
    expect(fast).toBeLessThan(normal)
    expect(b.gadgets.nitro).toBe(0)
    expect(b.nitroUntil).toBeLessThanOrEqual(NITRO_TICKS + 2)
  })

  it('a gadget with no charges left does nothing', () => {
    const s = createGame(cfg)
    step(cfg, s, Gadget.Nitro); step(cfg, s, Gadget.Nitro)
    expect(s.gadgets.nitro).toBe(0)
    expect(s.events.some((e) => e.type === 'gadget')).toBe(false)
  })

  it('oil spins out the first cop that drives over it, then is gone', () => {
    const s = createGame(cfg)
    step(cfg, s, Gadget.Oil)
    expect(s.oils).toHaveLength(1)
    expect(s.gadgets.oil).toBe(0)
    // Wait for a cop to leave the garage, then surround it with slicks.
    while (s.cops.every((c) => c.status === 'garage')) step(cfg, s)
    const c = s.cops.find((k) => k.status !== 'garage')!
    s.oils = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy, until: 9999 }))
    let spun = false
    for (let i = 0; i < 20 && !spun; i++) { step(cfg, s); spun = s.events.some((e) => e.type === 'spinout') }
    expect(spun).toBe(true)
    expect(c.status).toBe('blind')
    expect(s.oils).toHaveLength(3)
  })

  it('disguise: no cop can spot you while it lasts', () => {
    const s = createGame(cfg)
    step(cfg, s, Gadget.Disguise)
    const heat0 = s.heat
    for (let i = 0; i < DISGUISE_TICKS - 2; i++) {
      step(cfg, s)
      expect(s.cops.every((c) => c.status !== 'chase')).toBe(true)
    }
    expect(s.heat).toBe(heat0)
  })

  it('disguise: a cop on your tile cannot catch you while it lasts, and can again after', () => {
    const s = createGame(cfg)
    while (s.cops.every((c) => c.status === 'garage')) step(cfg, s)
    step(cfg, s, Gadget.Disguise)
    const c = s.cops.find((k) => k.status !== 'garage')!
    const lives = s.lives
    for (let i = 0; i < DISGUISE_TICKS - 5; i++) {
      c.x = s.player.x; c.y = s.player.y // park the cop on top of you
      step(cfg, s)
    }
    expect(s.lives).toBe(lives)
    expect(s.events.some((e) => e.type === 'caught')).toBe(false)
    for (let i = 0; i < 10; i++) { c.x = s.player.x; c.y = s.player.y; c.status = 'chase'; step(cfg, s) }
    expect(s.lives).toBe(lives - 1)
  })

  it('gadget inputs are valid in the log and replay exactly', () => {
    const log: InputLog = [[1, Dir.Left], [5, Gadget.Nitro], [30, Dir.Up], [40, Gadget.Oil], [60, Gadget.Disguise], [90, Dir.Right]]
    expect(validateInputLog(log).ok).toBe(true)
    expect(validateInputLog([[1, 8]]).ok).toBe(false)
    const live = createGame(cfg)
    let k = 0
    while (live.status === 'playing') step(cfg, live, k < log.length && log[k][0] === live.tick ? log[k++][1] : Dir.None)
    expect(hashState(replay(cfg, log))).toBe(hashState(live))
  })
})
