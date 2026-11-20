/**
 * A simple getaway-driver bot: heads for the nearest loot (or the open
 * safehouse) by road distance, and avoids stepping next to a non-blind cop
 * when it can. Used by the lobby's attract-mode demo and the balance report.
 * Deterministic.
 */
import { bfs } from '../engine/engine'
import { canMove } from '../engine/maze'
import { Dir, type GameState, type Maze } from '../engine/types'

const DX = [0, 0, 1, 0, -1]
const DY = [0, -1, 0, 1, 0]

export function botDir(maze: Maze, s: GameState, avoidCops = true): Dir {
  const goals = s.exit.open ? [s.exit] : s.loot.filter((l) => !l.taken)
  const targets = goals.length ? goals : [s.exit]
  const fromMe = bfs(maze, s.player)
  let best = targets[0]
  for (const g of targets) if (fromMe[g.y * maze.width + g.x] < fromMe[best.y * maze.width + best.x]) best = g
  const toGoal = bfs(maze, best)
  let dir = Dir.None, bestCost = Infinity
  for (const d of [Dir.Up, Dir.Right, Dir.Down, Dir.Left]) {
    if (!canMove(maze, s.player.x, s.player.y, d)) continue
    const nx = (s.player.x + DX[d] + maze.width) % maze.width
    const ny = (s.player.y + DY[d] + maze.height) % maze.height
    let cost = toGoal[ny * maze.width + nx]
    if (avoidCops) {
      for (const c of s.cops) {
        if (c.status === 'garage' || c.status === 'blind') continue
        const dist = Math.abs(c.x - nx) + Math.abs(c.y - ny)
        if (dist <= 2) cost += (3 - dist) * 25
      }
    }
    if (cost < bestCost) { bestCost = cost; dir = d }
  }
  return dir
}
