/**
 * Smooth motion for tile-stepped entities. The engine moves a piece one whole
 * tile every N ticks; we slide it from its previous tile to its current tile
 * over those N ticks, so it moves at a constant visual speed instead of
 * hopping and pausing. Render-only: never feeds back into the engine.
 */
import {
  Dir, PLAYER_PERIOD, canMove, copPeriod, type GameState, type Maze,
} from '../engine'

const DX = [0, 0, 1, 0, -1]
const DY = [0, -1, 0, 1, 0]

/**
 * The direction the engine will move the player on its next move, using the
 * same rule as movePlayer() (pending key press, rain slide, walls).
 */
export function predictNextDir(maze: Maze, s: GameState): Dir {
  const p = s.player
  let dir = p.dir
  if (p.wanted !== Dir.None && p.wanted !== p.dir) {
    if (p.slip > 0 && canMove(maze, p.x, p.y, p.dir)) {
      // still sliding in the old direction
    } else if (canMove(maze, p.x, p.y, p.wanted)) {
      dir = p.wanted
    }
  }
  return dir !== Dir.None && canMove(maze, p.x, p.y, dir) ? dir : Dir.None
}

export interface Pos { x: number; y: number }

interface Track { from: Pos; to: Pos; moveTick: number; period: number }

function periodOf(s: GameState, i: number): number {
  if (i === 0) return PLAYER_PERIOD
  return copPeriod(s.cops[i - 1])
}

function positions(s: GameState): Pos[] {
  return [{ x: s.player.x, y: s.player.y }, ...s.cops.map((c) => ({ x: c.x, y: c.y }))]
}

export class Motion {
  private tracks: Track[] = []

  constructor(s: GameState) {
    this.reset(s)
  }

  reset(s: GameState): void {
    this.tracks = positions(s).map((p) => ({ from: p, to: p, moveTick: s.tick, period: 1 }))
  }

  /** Call after every engine step. */
  update(s: GameState): void {
    const now = positions(s)
    if (now.length !== this.tracks.length) { this.reset(s); return }
    now.forEach((p, i) => {
      const t = this.tracks[i]
      if (p.x === t.to.x && p.y === t.to.y) return
      const jump = Math.abs(p.x - t.to.x) + Math.abs(p.y - t.to.y) > 2 // tunnel wrap or respawn
      // Start from where the piece is currently drawn, so a fast follow-up move never snaps back.
      const drawn = this.at(i, s.tick - 1, 1)
      this.tracks[i] = { from: jump ? p : drawn, to: p, moveTick: s.tick, period: periodOf(s, i) }
    })
  }

  private at(i: number, tick: number, alpha: number): Pos {
    const t = this.tracks[i]
    const k = Math.max(0, Math.min(1, (tick - t.moveTick + alpha) / t.period))
    return { x: t.from.x + (t.to.x - t.from.x) * k, y: t.from.y + (t.to.y - t.from.y) * k }
  }

  private drawnPlayer: Pos | null = null

  /**
   * Where to draw the player's car. Unlike the cops (drawn sliding from their
   * previous tile, i.e. slightly behind), the player is drawn from the tile the
   * engine has it on TOWARD the tile it will actually enter next. So when the car
   * looks like it is at a junction, it really is, and a turn pressed then
   * happens at that junction instead of the next one.
   */
  player(maze: Maze, s: GameState, alpha: number): Pos {
    const p = s.player
    const dir = predictNextDir(maze, s)
    const k = Math.min(1, (p.clock + alpha) / PLAYER_PERIOD)
    let tx = p.x, ty = p.y
    if (dir !== Dir.None) {
      const nx = p.x + DX[dir], ny = p.y + DY[dir]
      if (nx >= 0 && ny >= 0 && nx < maze.width && ny < maze.height) { tx = p.x + DX[dir] * k; ty = p.y + DY[dir] * k }
    }
    const d = this.drawnPlayer
    // Small smoothing so a change of plan (new key press) eases instead of jumping;
    // big jumps (respawn, tunnel) snap.
    if (!d || Math.abs(d.x - tx) + Math.abs(d.y - ty) > 1.5) this.drawnPlayer = { x: tx, y: ty }
    else this.drawnPlayer = { x: d.x + (tx - d.x) * 0.55, y: d.y + (ty - d.y) * 0.55 }
    return this.drawnPlayer
  }

  /** Positions to draw now; `alpha` is the fraction of the current tick elapsed. */
  sample(s: GameState, alpha: number, maze?: Maze): Pos[] {
    const out = this.tracks.map((_, i) => this.at(i, s.tick, alpha))
    if (maze) out[0] = this.player(maze, s, alpha)
    return out
  }
}
