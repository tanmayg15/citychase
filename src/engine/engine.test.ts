import { describe, expect, it } from 'vitest'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, Dir, ENGINE_VERSION, MAX_TICKS, REPLAYABLE_VERSIONS, canSee,
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

  it('edited inputs change the outcome (tampering is visible)', () => {
    // Note: a single edit can be a no-op if it is overridden before the car
    // reaches a junction, so this rewrites the first second of driving.
    const cfg = config()
    const log = randomLog(11)
    const edited: InputLog = log.map(([t, d], i) => (i < 3 ? [t, ((d % 4) + 1) as Dir] : [t, d]))
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
        "hash": "3343c674",
        "score": 291,
        "status": "busted",
        "tick": 586,
      }
    `)
  })
})

describe('older runs still replay (REPLAYABLE_VERSIONS)', () => {
  it('v2 golden run: same score, length and outcome as when it was pinned under v2', () => {
    const s = replay(config(), randomLog(2026))
    expect({ score: s.score, tick: s.tick, status: s.status }).toEqual({ score: 291, tick: 586, status: 'busted' })
  })

  it('direction-only logs play out identically with or without the v3 gadget crates', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const cfg = config({ seed })
      const log = randomLog(seed)
      const withCrates = replay(cfg, log)
      const bare = createGame(cfg)
      bare.crates = []
      let k = 0
      while (bare.status === 'playing') step(cfg, bare, k < log.length && log[k][0] === bare.tick ? log[k++][1] : Dir.None)
      const pick = (s: typeof bare) => ({ score: s.score, tick: s.tick, status: s.status, rng: s.rng, player: s.player, cops: s.cops, loot: s.loot })
      expect(pick(withCrates)).toEqual(pick(bare))
    }
  })

  it('accepts v2 and v3 only', () => {
    expect(REPLAYABLE_VERSIONS).toEqual([2, 3])
    expect(REPLAYABLE_VERSIONS).toContain(ENGINE_VERSION)
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

  it('places 10 spread-out loot drops and a far safehouse, the same every game', () => {
    const a = createGame(config({ seed: 1 })), b = createGame(config({ seed: 999 }))
    expect(a.loot.length).toBeGreaterThanOrEqual(5)
    expect(a.loot).toEqual(b.loot)
    expect(a.exit).toEqual(b.exit)
    expect(a.exit.open).toBe(false)
  })

  it('driving over loot scores its value; enough loot opens the safehouse; reaching it escapes', () => {
    const cfg = config()
    const s = createGame(cfg)
    s.cops = [] // no police for this rules check
    // Put loot right next to the start and pretend the rest is already taken.
    s.loot = [{ x: 8, y: 11, value: 300, taken: false }]
    s.exit = { x: 7, y: 11, open: false }
    step(cfg, s, Dir.Left)
    for (let i = 0; i < 3; i++) step(cfg, s)
    expect(s.lootScore).toBe(300)
    expect(s.exit.open).toBe(true)
    for (let i = 0; i < 4; i++) step(cfg, s)
    expect(s.status).toBe('escaped')
    expect(s.score).toBeGreaterThan(300 + 1000)
  })

  it('the run ends by MAX_TICKS even with no input', () => {
    const s = replay(config(), [])
    expect(s.status).not.toBe('playing')
    expect(s.tick).toBeLessThanOrEqual(MAX_TICKS)
  })

  it('cops see ahead down a street (headlights), not behind, not through buildings, not beyond range', () => {
    expect(canSee(maze, 1, 3, Dir.Right, 10, 3, 9)).toBe(true) // open row 3, facing you
    expect(canSee(maze, 1, 3, Dir.Left, 10, 3, 9)).toBe(false) // facing away: you can sneak up
    expect(canSee(maze, 1, 3, Dir.Right, 10, 3, 5)).toBe(false) // out of range
    expect(canSee(maze, 8, 1, Dir.Right, 10, 1, 9)).toBe(false) // building at (9,1) in between
    expect(canSee(maze, 1, 1, Dir.Down, 2, 3, 9)).toBe(false) // not on the same street
    expect(canSee(maze, 5, 5, Dir.Up, 5, 6, 9)).toBe(true) // right behind: always noticed
  })

  it('being seen raises heat, puts the cop in chase, and costs points', () => {
    const cfg = config()
    const s = createGame(cfg)
    const c = s.cops[0]
    Object.assign(c, { status: 'patrol', x: 12, y: 11, tx: 12, ty: 11, dir: Dir.Left })
    s.lootScore = 100
    step(cfg, s)
    expect(c.status).toBe('chase')
    expect(s.heat).toBe(1)
    expect(s.lastSeen).toEqual({ x: 9, y: 11 })
    s.heat = 40
    step(cfg, s)
    expect(s.score).toBe(100 - Math.floor(41 / 4))
  })

  it('a smoke bomb blinds nearby cops for powerTicks, and blind cops cannot catch you', () => {
    const cfg = config()
    const s = createGame(cfg)
    s.smokes = [{ x: 8, y: 11, taken: false }]
    for (const c of s.cops) Object.assign(c, { status: 'patrol', x: 4, y: 11 })
    step(cfg, s, Dir.Left)
    for (let i = 0; i < 3; i++) step(cfg, s)
    expect(s.cops.every((c) => c.status === 'blind')).toBe(true)
    expect(s.cops[0].until).toBe(3 + cfg.modifiers.powerTicks)
    s.cops[0].x = s.player.x; s.cops[0].y = s.player.y
    const lives = s.lives
    step(cfg, s)
    expect(s.lives).toBe(lives)
  })

  it('getting caught costs a life and resets you to the start; 3 catches = busted', () => {
    const cfg = config()
    const s = createGame(cfg)
    for (let n = 3; n > 0; n--) {
      Object.assign(s.cops[0], { status: 'patrol', x: s.player.x + 1, y: s.player.y, clock: 99, tx: s.player.x, ty: s.player.y, dir: Dir.Left })
      s.pauseUntil = 0
      step(cfg, s)
    }
    expect(s.status).toBe('busted')
    expect(s.lives).toBe(0)
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

  it('wind pushes patrol cars in the wind direction', () => {
    const calm = replay(config(), randomLog(3))
    const windy = replay(config({}, { ...CLEAR_WEATHER, windSpeed: 15, windDeg: 0 }), randomLog(3))
    expect(hashState(calm)).not.toBe(hashState(windy))
  })
})

describe('weatherToModifiers', () => {
  it('maps conditions to modifiers', () => {
    expect(weatherToModifiers(CLEAR_WEATHER)).toEqual({ slipTiles: 0, wind: null, visionRadius: null, copVision: 8, powerTicks: 100 })
    expect(weatherToModifiers({ ...CLEAR_WEATHER, condition: 'snow' }).slipTiles).toBe(1)
    expect(weatherToModifiers({ ...CLEAR_WEATHER, isNight: true })).toMatchObject({ visionRadius: 5, copVision: 5 })
    expect(weatherToModifiers({ ...CLEAR_WEATHER, tempC: 31 }).powerTicks).toBe(160)
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
      personality: 'swarm', cops: ['roam', 'roam', 'guardLoot', 'guardExit'],
      chokepoints: [{ x: 4, y: 3 }], taunt: '  Rain slows you down. ', extra: 1,
    }, maze)
    expect(r.ok && r.plan).toEqual({
      version: 1, personality: 'swarm', cops: ['roam', 'roam', 'guardLoot', 'guardExit'],
      chokepoints: [{ x: 4, y: 3 }], taunt: 'Rain slows you down.',
    })
  })

  it.each([
    ['null', null],
    ['wrong cop count', { ...DEFAULT_PLAN, cops: ['roam'] }],
    ['unknown mode', { ...DEFAULT_PLAN, cops: ['roam', 'roam', 'roam', 'teleport'] }],
    ['chokepoint in a wall', { ...DEFAULT_PLAN, chokepoints: [{ x: 0, y: 0 }] }],
    ['chokepoint off-grid', { ...DEFAULT_PLAN, chokepoints: [{ x: 500, y: 1 }] }],
    ['empty taunt', { ...DEFAULT_PLAN, taunt: '' }],
  ])('falls back to the default plan on %s', (_name, plan) => {
    expect(validatePlan(plan, maze).ok).toBe(false)
    expect(planOrDefault(plan, maze)).toBe(DEFAULT_PLAN)
  })
})
