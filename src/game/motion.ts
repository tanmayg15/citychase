/**
 * Smooth motion for tile-stepped entities. The engine moves a piece one whole
 * tile every N ticks; we slide it from its previous tile to its current tile
 * over those N ticks, so it moves at a constant visual speed instead of
 * hopping and pausing. Render-only: never feeds back into the engine.
 */
import {
  EATEN_PERIOD, FRIGHTENED_PERIOD, GHOST_PERIOD, PLAYER_PERIOD, type GameState,
} from '../engine'

export interface Pos { x: number; y: number }

interface Track { from: Pos; to: Pos; moveTick: number; period: number }

function periodOf(s: GameState, i: number): number {
  if (i === 0) return PLAYER_PERIOD
  const g = s.ghosts[i - 1]
  return g.status === 'eaten' ? EATEN_PERIOD : g.status === 'frightened' ? FRIGHTENED_PERIOD : GHOST_PERIOD
}

function positions(s: GameState): Pos[] {
  return [{ x: s.player.x, y: s.player.y }, ...s.ghosts.map((g) => ({ x: g.x, y: g.y }))]
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

  /** Positions to draw now; `alpha` is the fraction of the current tick elapsed. */
  sample(s: GameState, alpha: number): Pos[] {
    return this.tracks.map((_, i) => this.at(i, s.tick, alpha))
  }
}
