import { Cell, Dir, type Maze, type Point } from './types'

/**
 * Maze text legend:
 *   #  wall        .  orb        o  power core
 *   P  player spawn               G  ghost spawn (ghosts cycle through them)
 *   (space) empty floor
 * Rows that are open at the left/right edge wrap around (tunnels).
 */
export function parseMaze(rows: string[]): Maze {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  if (height < 3 || width < 3) throw new Error('maze too small')
  const cells: number[] = []
  let playerSpawn: Point | null = null
  const ghostSpawns: Point[] = []
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} has length ${row.length}, expected ${width}`)
    for (let x = 0; x < width; x++) {
      const ch = row[x]
      switch (ch) {
        case '#': cells.push(Cell.Wall); break
        case '.': cells.push(Cell.Orb); break
        case 'o': cells.push(Cell.Core); break
        case ' ': cells.push(Cell.Empty); break
        case 'P': cells.push(Cell.Empty); playerSpawn = { x, y }; break
        case 'G': cells.push(Cell.Empty); ghostSpawns.push({ x, y }); break
        default: throw new Error(`unknown maze char "${ch}" at ${x},${y}`)
      }
    }
  })
  if (!playerSpawn) throw new Error('maze has no player spawn')
  if (ghostSpawns.length === 0) throw new Error('maze has no ghost spawn')
  return { width, height, cells, playerSpawn, ghostSpawns }
}

export const DX = [0, 0, 1, 0, -1]
export const DY = [0, -1, 0, 1, 0]
export const REVERSE = [Dir.None, Dir.Down, Dir.Left, Dir.Up, Dir.Right]

/** Neighbouring tile in a direction, wrapping at the edges. */
export function stepPoint(maze: Maze, x: number, y: number, dir: Dir): Point {
  let nx = x + DX[dir]
  let ny = y + DY[dir]
  if (nx < 0) nx = maze.width - 1
  else if (nx >= maze.width) nx = 0
  if (ny < 0) ny = maze.height - 1
  else if (ny >= maze.height) ny = 0
  return { x: nx, y: ny }
}

export function isOpen(maze: Maze, x: number, y: number): boolean {
  return maze.cells[y * maze.width + x] !== Cell.Wall
}

export function canMove(maze: Maze, x: number, y: number, dir: Dir): boolean {
  if (dir === Dir.None) return false
  const p = stepPoint(maze, x, y, dir)
  return isOpen(maze, p.x, p.y)
}
