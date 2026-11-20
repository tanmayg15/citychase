import { describe, expect, it } from 'vitest'
import {
  CLEAR_WEATHER, DEFAULT_PLAN, Dir, createGame, replay, rngInt, weatherToModifiers,
  type InputLog, type Maze,
} from '@/engine'
import { CITY_MAZES, cityMaze } from './index'

/** All open tiles reachable from the player spawn (with edge wrap). */
function reachable(m: Maze): number {
  const seen = new Set([m.playerSpawn.y * m.width + m.playerSpawn.x])
  const q = [...seen]
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % m.width, y = Math.floor(q[h] / m.width)
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = (x + dx + m.width) % m.width, ny = (y + dy + m.height) % m.height
      const k = ny * m.width + nx
      if (m.cells[k] !== 1 && !seen.has(k)) { seen.add(k); q.push(k) }
    }
  }
  return seen.size
}

describe('city mazes', () => {
  it('ships all 7 cities with unique ids and IANA timezones', () => {
    expect(CITY_MAZES).toHaveLength(7)
    expect(new Set(CITY_MAZES.map((c) => c.id)).size).toBe(7)
    for (const c of CITY_MAZES) expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezone })).not.toThrow()
  })

  describe.each(CITY_MAZES.map((c) => [c.id, c] as const))('%s', (_id, city) => {
    const maze = cityMaze(city)

    it('parses and every open tile is reachable from the player', () => {
      const open = maze.cells.filter((c) => c !== 1).length
      expect(reachable(maze)).toBe(open)
    })

    it('has 4 smoke-bomb spots, enough streets, and a police garage', () => {
      expect(maze.cells.filter((c) => c === 3)).toHaveLength(4)
      expect(maze.cells.filter((c) => c === 2).length).toBeGreaterThan(120)
      expect(maze.ghostSpawns.length).toBeGreaterThanOrEqual(3)
    })

    it('has no dead-end corridors', () => {
      for (let y = 0; y < maze.height; y++) {
        for (let x = 0; x < maze.width; x++) {
          if (maze.cells[y * maze.width + x] === 1) continue
          const exits = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => {
            const nx = (x + dx + maze.width) % maze.width, ny = (y + dy + maze.height) % maze.height
            return maze.cells[ny * maze.width + nx] !== 1
          }).length
          expect(exits, `dead end at ${x},${y}`).toBeGreaterThanOrEqual(2)
        }
      }
    })

    it('runs a full game deterministically', () => {
      const cfg = { maze, seed: 42, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }
      const log: InputLog = []
      let rng = 9
      for (let t = 0; t < 2000; t += 6) { const [d, n] = rngInt(rng, 4); rng = n; log.push([t, (d + 1) as Dir]) }
      expect(createGame(cfg).loot.length).toBeGreaterThanOrEqual(8)
      expect(replay(cfg, log).status).not.toBe('playing')
    })
  })
})
