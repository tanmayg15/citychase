/**
 * Decides which police radio line fits what just happened in the game.
 * Pure and presentation-only: it reads the state after each engine step and
 * never feeds back into the game. Lines it picks while the radio is busy are
 * simply dropped by the sound engine (except the ones it retries).
 */
import { TICK_RATE, type GameState } from '../engine'
import type { RadioId } from '../shared/radio-lines'

const SPOTTED: RadioId[] = ['spotted', 'spotted2', 'spotted3']
const SPOTTED_GAP_MS = 8000
const LOST_GAP_MS = 10000
const LOW_TIME_SECONDS = 30

export class RadioDirector {
  private spottedN = 0
  private lastSpotted = -Infinity
  private lastLost = -Infinity
  private wasChased = false
  private awaitingRespawn = false
  private saidLowTime = false

  /** Lines for this tick, most important first. `maxTicks` is the run length. */
  cues(s: GameState, now: number, maxTicks: number): RadioId[] {
    const out: RadioId[] = []
    for (const e of s.events) {
      switch (e.type) {
        case 'exitOpen': out.push('safehouse'); break
        case 'smoke': if (e.blinded > 0) out.push('smoke'); break
        case 'spinout': out.push('spinout'); break
        case 'gadget':
          if (e.kind === 'nitro') out.push('nitro')
          else if (e.kind === 'disguise') out.push('disguise')
          break
        case 'spotted':
          if (now - this.lastSpotted > SPOTTED_GAP_MS) {
            this.lastSpotted = now
            out.push(SPOTTED[this.spottedN++ % SPOTTED.length])
          }
          break
        case 'caught':
          if (e.livesLeft <= 0) out.unshift('busted')
          else { out.unshift(e.livesLeft === 1 ? 'lastlife' : 'caught'); this.awaitingRespawn = true }
          break
        case 'end':
          if (e.status === 'escaped') out.push('escaped')
          break
      }
    }
    // Back on the road after the catch pause.
    if (this.awaitingRespawn && s.status === 'playing' && s.tick >= s.pauseUntil) {
      this.awaitingRespawn = false
      out.push('respawn')
    }
    // Every chasing cop lost you (not via smoke or disguise, which have their own lines).
    const chased = s.cops.some((c) => c.status === 'chase')
    if (this.wasChased && !chased && s.status === 'playing' && s.tick >= s.pauseUntil &&
        !s.events.some((e) => e.type === 'smoke' || e.type === 'gadget' || e.type === 'caught') &&
        now - this.lastLost > LOST_GAP_MS) {
      this.lastLost = now
      out.push('lost')
    }
    this.wasChased = chased
    if (!this.saidLowTime && s.status === 'playing' && maxTicks - s.tick <= LOW_TIME_SECONDS * TICK_RATE) {
      this.saidLowTime = true
      out.push('lowtime')
    }
    return out
  }
}
