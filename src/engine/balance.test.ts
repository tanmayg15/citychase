import { it } from 'vitest'
import { CITY_MAZES, cityMaze } from '../cities'
import { CLEAR_WEATHER, DEFAULT_PLAN, Dir, createGame, step, weatherToModifiers } from './index'
import { bfs } from './engine'
import { canMove } from './maze'
/** Balance report: a bot that ignores cops and drives straight to loot. Run: BALANCE=1 npx vitest run src/engine/balance --silent=false --reporter=verbose */
it.runIf(process.env.BALANCE)('balance report', () => {
  for (const city of CITY_MAZES) {
    const maze = cityMaze(city)
    const base = { maze, seed: 7, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }
    const out: Record<string, number> = {}
    let loot = 0, ticks = 0, heat = 0
    const N = 20
    for (let r = 0; r < N; r++) {
      const c = { ...base, seed: 1000 + r }
      const s = createGame(c)
      while (s.status === 'playing') {
        const goals = s.exit.open ? [s.exit] : s.loot.filter((l) => !l.taken)
        const target = goals.length ? goals : [s.exit]
        const d = bfs(maze, s.player)
        let best = target[0]
        for (const g of target) if (d[g.y * maze.width + g.x] < d[best.y * maze.width + best.x]) best = g
        const db = bfs(maze, best)
        let dir = Dir.None, bd = Infinity
        for (const dd of [1, 2, 3, 4] as Dir[]) if (canMove(maze, s.player.x, s.player.y, dd)) {
          const nx = (s.player.x + [0, 0, 1, 0, -1][dd] + maze.width) % maze.width
          const ny = (s.player.y + [0, -1, 0, 1, 0][dd] + maze.height) % maze.height
          if (db[ny * maze.width + nx] < bd) { bd = db[ny * maze.width + nx]; dir = dd }
        }
        step(c, s, dir)
      }
      out[s.status] = (out[s.status] ?? 0) + 1; loot += s.lootTaken; ticks += s.tick; heat += s.heat
    }
    const h = createGame(base)
    console.log(city.id.padEnd(20), 'loot', h.loot.length, 'smokes', h.smokes.length, JSON.stringify(out), 'avgLoot', (loot / N).toFixed(1), 'avgSec', (ticks / N / 20).toFixed(0), 'avgHeat', (heat / N).toFixed(0))
  }
})
