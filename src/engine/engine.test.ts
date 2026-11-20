import { describe, expect, it } from 'vitest'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, Dir, MAX_TICKS,
  createGame, hashState, parseMaze, planOrDefault, replay, rngInt, step,
  validateInputLog, validatePlan, weatherToModifiers,
  type GameConfig, type InputLog, type WeatherSnapshot,
} from './index'
import { TEST_MAZE_ROWS } from './fixtures'

const maze = parseMaze(TEST_MAZE_ROWS)

function config(overrides: Partial<GameConfig> = {}, weather: WeatherSnapshot = CLEAR_WEATHER): GameConfig {
  return { maze, seed: 12345, modifiers: weatherToModifiers(weather), plan: DEFAULT_PLAN, ...overrides }
}

/** A pseudo-random but reproducible input log, like a real player mashing keys. */
function randomLog(seed: number, every = 7): InputLog {
  const log: InputLog = []
  let rng = seed
  for (let t = 0; t < MAX_TICKS; t += every) {
    const [d, next] = rngInt(rng, 4)
    rng = next
    log.push([t, (d + 1) as Dir])
  }
  return log
}

/** Live play: step tick by tick, feeding inputs the way the browser would. */
function playLive(cfg: GameConfig, log: InputLog) {
  const s = createGame(cfg)
  const byTick = new Map(log)
  while (s.status === 'playing') step(cfg, s, byTick.get(s.tick) ?? Dir.None)
  return s
}

describe('determinism', () => {
  it('same config + inputs give an identical final state hash', () => {
    const cfg = config()
    const log = randomLog(7)
    const a = replay(cfg, log)
    const b = replay(cfg, log)
    expect(hashState(a)).toBe(hashState(b))
    expect(a.score).toBe(b.score)
  })

  it('server replay matches live tick-by-tick play', () => {
    for (const seed of [1, 2, 3, 99, 0xdeadbeef]) {
      const cfg = config({ seed })
      const log = randomLog(seed, 5)
      expect(hashState(replay(cfg, log))).toBe(hashState(playLive(cfg, log)))
    }
  })

  it('a different seed changes the game', () => {
    const log = randomLog(7)
    expect(hashState(replay(config({ seed: 1 }), log))).not.toBe(hashState(replay(config({ seed: 2 }), log)))
  })

  it('a single edited input changes the outcome (tampering is visible)', () => {
    const cfg = config()
    const log = randomLog(11)
    const edited: InputLog = log.map(([t, d], i) => (i === 3 ? [t, ((d % 4) + 1) as Dir] : [t, d]))
    expect(hashState(replay(cfg, log))).not.toBe(hashState(replay(cfg, edited)))
  })

  it('does not mutate the config maze', () => {
    const before = [...maze.cells]
    replay(config(), randomLog(5))
    expect(maze.cells).toEqual(before)
  })

  it('golden replay: recorded log reproduces a pinned hash', () => {
    // If this fails, engine behaviour changed: old replays would no longer verify.
    const s = replay(config(), randomLog(2026))
    expect({ hash: hashState(s), score: s.score, tick: s.tick, status: s.status }).toMatchInlineSnapshot(`
      {
        "hash": "c7321e04",
        "score": 340,
        "status": "lost",
        "tick": 742,
      }
    `)
  })
})

describe('rules', () => {
  it('walls block the player', () => {
    const cfg = config()
    const s = createGame(cfg)
    step(cfg, s, Dir.Down) // (9,12) is a wall
    for (let i = 0; i < 20; i++) step(cfg, s)
    expect([s.player.x, s.player.y]).toEqual([9, 11])
  })

  it('eating an orb scores 10 and removes it', () => {
    const cfg = config()
    const s = createGame(cfg)
    step(cfg, s, Dir.Left)
    for (let i = 0; i < 3; i++) step(cfg, s)
    expect([s.player.x, s.player.y]).toEqual([8, 11])
    expect(s.score).toBe(10)
    expect(s.cells[11 * maze.width + 8]).toBe(0)
  })

  it('the run ends by MAX_TICKS even with no input', () => {
    const s = replay(config(), [])
    expect(s.status).not.toBe('playing')
    expect(s.tick).toBeLessThanOrEqual(MAX_TICKS)
  })

  it('power core makes ghosts frightened for powerTicks', () => {
    const cfg = config()
    const s = createGame(cfg)
    s.cells[11 * maze.width + 8] = 3 // put a core next to the player
    s.pelletsLeft++
    for (const g of s.ghosts) g.status = 'active'
    step(cfg, s, Dir.Left)
    for (let i = 0; i < 3; i++) step(cfg, s)
    expect(s.ghosts.every((g) => g.status === 'frightened')).toBe(true)
    expect(s.powerUntil).toBe(3 + cfg.modifiers.powerTicks)
  })

  it('rain adds one tile of momentum on a turn', () => {
    // From (9,11) heading right, the turn Up is possible at x=12.
    const run = (weather: WeatherSnapshot) => {
      const cfg = config({}, weather)
      const s = createGame(cfg)
      step(cfg, s, Dir.Right)
      for (let i = 0; i < 11; i++) step(cfg, s) // 3 moves: now at (12,11)
      expect([s.player.x, s.player.y]).toEqual([12, 11])
      step(cfg, s, Dir.Up)
      for (let i = 0; i < 3; i++) step(cfg, s)
      return [s.player.x, s.player.y]
    }
    expect(run(CLEAR_WEATHER)).toEqual([12, 10])
    expect(run({ ...CLEAR_WEATHER, condition: 'rain' })).toEqual([13, 11])
  })

  it('wind pushes ghosts in the wind direction', () => {
    const calm = replay(config(), randomLog(3))
    const windy = replay(config({}, { ...CLEAR_WEATHER, windSpeed: 15, windDeg: 0 }), randomLog(3))
    expect(hashState(calm)).not.toBe(hashState(windy))
  })
})

describe('weatherToModifiers', () => {
  it('maps conditions to modifiers', () => {
    expect(weatherToModifiers(CLEAR_WEATHER)).toEqual({ slipTiles: 0, wind: null, visionRadius: null, powerTicks: 120 })
    expect(weatherToModifiers({ ...CLEAR_WEATHER, condition: 'snow' }).slipTiles).toBe(1)
    expect(weatherToModifiers({ ...CLEAR_WEATHER, isNight: true }).visionRadius).toBe(5)
    expect(weatherToModifiers({ ...CLEAR_WEATHER, tempC: 31 }).powerTicks).toBe(180)
    // Wind FROM the west (270°) blows ghosts east (Right).
    expect(weatherToModifiers({ ...CLEAR_WEATHER, windSpeed: 9, windDeg: 270 }).wind).toEqual({ dir: Dir.Right, every: 10 })
  })
})

describe('input log validation', () => {
  it.each([
    ['not an array', {}],
    ['bad dir', [[0, 9]]],
    ['negative tick', [[-1, 1]]],
    ['tick past cap', [[MAX_TICKS, 1]]],
    ['non-increasing', [[5, 1], [5, 2]]],
    ['float tick', [[1.5, 1]]],
    ['too long', Array.from({ length: 5000 }, (_, i) => [i, 1])],
  ])('rejects %s', (_name, log) => {
    expect(validateInputLog(log).ok).toBe(false)
    expect(() => replay(config(), log as InputLog)).toThrow()
  })
})

describe('commander plan validation', () => {
  it('accepts a valid plan and drops extra fields', () => {
    const r = validatePlan({
      personality: 'swarm', ghosts: ['chase', 'chase', 'ambush', 'cutoff'],
      chokepoints: [{ x: 4, y: 3 }], taunt: '  Rain slows you down. ', extra: 1,
    }, maze)
    expect(r.ok && r.plan).toEqual({
      version: 1, personality: 'swarm', ghosts: ['chase', 'chase', 'ambush', 'cutoff'],
      chokepoints: [{ x: 4, y: 3 }], taunt: 'Rain slows you down.',
    })
  })

  it.each([
    ['null', null],
    ['wrong ghost count', { ...DEFAULT_PLAN, ghosts: ['chase'] }],
    ['unknown mode', { ...DEFAULT_PLAN, ghosts: ['chase', 'chase', 'chase', 'teleport'] }],
    ['chokepoint in a wall', { ...DEFAULT_PLAN, chokepoints: [{ x: 0, y: 0 }] }],
    ['chokepoint off-grid', { ...DEFAULT_PLAN, chokepoints: [{ x: 500, y: 1 }] }],
    ['empty taunt', { ...DEFAULT_PLAN, taunt: '' }],
  ])('falls back to the default plan on %s', (_name, plan) => {
    expect(validatePlan(plan, maze).ok).toBe(false)
    expect(planOrDefault(plan, maze)).toBe(DEFAULT_PLAN)
  })
})
