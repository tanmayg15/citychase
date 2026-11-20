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
   * Where to draw the player's car. The engine keeps the car on a tile for
   * PLAYER_PERIOD ticks and decides where it goes next when it leaves. We draw
   * the car ARRIVING at the tile for the first half of that time and LEAVING it
   * (toward the tile it will really enter next) for the second half, so the
   * moment it is drawn at the centre of a junction is the middle of the window
   * in which a turn still counts. Before the centre: the turn happens here.
   * After the centre: see shouldHoldTurn().
   */
  player(maze: Maze, s: GameState, alpha: number): Pos {
    const p = s.player
    const k = Math.min(1, (p.clock + alpha) / PLAYER_PERIOD)
    let tx = p.x, ty = p.y
    // Only draw the "arriving" half if the car really entered this tile on its
    // last move. A parked car (against a wall, or just started) keeps counting
    // its clock too, and drawing it arriving every cycle made it shake.
    const t = this.tracks[0]
    const justArrived = !!t && t.to.x === p.x && t.to.y === p.y && (t.from.x !== t.to.x || t.from.y !== t.to.y) &&
      s.tick - t.moveTick < PLAYER_PERIOD
    if (k < 0.5) {
      if (justArrived && p.dir !== Dir.None) { tx = p.x - DX[p.dir] * (0.5 - k); ty = p.y - DY[p.dir] * (0.5 - k) }
    } else {
      const dir = predictNextDir(maze, s)
      if (dir !== Dir.None) {
        const nx = p.x + DX[dir], ny = p.y + DY[dir]
        if (nx >= 0 && ny >= 0 && nx < maze.width && ny < maze.height) { tx = p.x + DX[dir] * (k - 0.5); ty = p.y + DY[dir] * (k - 0.5) }
      }
    }
    const d = this.drawnPlayer
    // Light smoothing so a change of plan eases instead of jumping; respawns snap.
    if (!d || Math.abs(d.x - tx) + Math.abs(d.y - ty) > 1.5) this.drawnPlayer = { x: tx, y: ty }
    else this.drawnPlayer = { x: d.x + (tx - d.x) * 0.6, y: d.y + (ty - d.y) * 0.6 }
    return this.drawnPlayer
  }

  /** Positions to draw now; `alpha` is the fraction of the current tick elapsed. */
  sample(s: GameState, alpha: number, maze?: Maze): Pos[] {
    const out = this.tracks.map((_, i) => this.at(i, s.tick, alpha))
    if (maze) out[0] = this.player(maze, s, alpha)
    return out
  }
}

/**
 * True if a side turn pressed now should wait until the car has moved on:
 * the car is already drawn past the centre of this tile (second half of its
 * time here) and the turn would otherwise still be taken HERE. Reversing and
 * presses while stopped are never held. Holding only changes WHEN the key is
 * fed to the engine, so the input log and server replay stay exact.
 */
export function shouldHoldTurn(maze: Maze, s: GameState, dir: Dir): boolean {
  const p = s.player
  if (p.dir === Dir.None || dir === p.dir) return false
  const reverse = (p.dir + 1) % 4 + 1 === dir // Up<->Down, Left<->Right
  if (reverse) return false
  if (p.clock * 2 < PLAYER_PERIOD) return false // still before the centre: turn here
  return canMove(maze, p.x, p.y, dir) // only matters if the turn is possible here
}
