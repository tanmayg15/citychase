/**
 * Procedural sound effects with the Web Audio API: no audio files, nothing
 * downloaded, all original. Presentation only; never affects the game.
 * Browsers only allow audio after a user gesture, so call resume() from a click/keypress.
 */

const MUTE_KEY = 'citychase:muted'

export function loadMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function saveMuted(m: boolean): void {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* storage blocked */ }
}

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private sirenOsc: OscillatorNode | null = null
  private sirenGain: GainNode | null = null
  private sirenOn = false
  private noise: AudioBuffer | null = null
  private muted: boolean
  /** False while paused / not in play: continuous sounds silent, one-shots dropped. */
  private active = true

  constructor(muted = loadMuted()) {
    this.muted = muted
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    const AC = typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
    if (!AC) return null
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.55
    this.master.connect(ctx.destination)

    // Engine: low sawtooth through a lowpass, gain follows whether the car moves.
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 55
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(lp).connect(this.engineGain).connect(this.master)
    this.engineOsc.start()

    // Siren: a two-tone wail, faded in/out when a cop is chasing.
    this.sirenOsc = ctx.createOscillator()
    this.sirenOsc.type = 'triangle'
    this.sirenOsc.frequency.value = 760
    this.sirenGain = ctx.createGain()
    this.sirenGain.gain.value = 0
    this.sirenOsc.connect(this.sirenGain).connect(this.master)
    this.sirenOsc.start()

    // White noise buffer for whooshes and crashes.
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return ctx
  }

  /** Call from a user gesture (Start button / key press). */
  resume(): void {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  setMuted(m: boolean): void {
    this.muted = m
    saveMuted(m)
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05)
  }

  isMuted(): boolean {
    return this.muted
  }

  /**
   * Pause: silence the engine and siren and drop one-off sounds until resumed.
   * (Suspending the whole AudioContext was not enough: the resume-on-gesture
   * safety net woke it up again on the next key press while still paused.)
   */
  setPaused(paused: boolean): void {
    this.active = !paused
    if (paused) this.quiet()
  }

  /** Continuous sounds, called every frame. */
  update(moving: boolean, wanted: boolean, timeMs: number): void {
    const ctx = this.ctx
    if (!ctx || !this.engineGain || !this.engineOsc || !this.sirenGain || !this.sirenOsc) return
    if (!this.active) return
    const t = ctx.currentTime
    this.engineGain.gain.setTargetAtTime(moving ? 0.16 : 0.06, t, 0.15)
    this.engineOsc.frequency.setTargetAtTime(moving ? 78 + 6 * Math.sin(timeMs / 180) : 50, t, 0.2)
    if (wanted !== this.sirenOn) {
      this.sirenOn = wanted
      this.sirenGain.gain.setTargetAtTime(wanted ? 0.07 : 0, t, 0.25)
    }
    if (wanted) this.sirenOsc.frequency.setTargetAtTime(Math.floor(timeMs / 450) % 2 ? 960 : 720, t, 0.05)
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.18, slideTo?: number) {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.active) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, ctx.currentTime + start)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur)
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start)
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur)
    o.connect(g).connect(this.master)
    o.start(ctx.currentTime + start)
    o.stop(ctx.currentTime + start + dur + 0.05)
  }

  private burst(dur: number, filterFreq: number, vol: number, type: BiquadFilterType = 'lowpass', sweepTo?: number) {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noise || !this.active) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(filterFreq, ctx.currentTime)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start()
    src.stop(ctx.currentTime + dur + 0.05)
  }

  countdown(final: boolean): void { this.tone(final ? 880 : 440, 0, final ? 0.35 : 0.15, 'square', 0.14) }
  /** "Cha-ching": two bright notes, a high ping and a sparkle of noise. */
  loot(): void {
    this.tone(1319, 0, 0.08, 'square', 0.12)
    this.tone(1760, 0.06, 0.22, 'triangle', 0.2)
    this.tone(2637, 0.1, 0.25, 'sine', 0.08)
    this.burst(0.18, 6000, 0.12, 'highpass')
  }
  /** Tyre screech on a turn; longer and lower on wet roads. */
  screech(wet: boolean): void {
    this.burst(wet ? 0.38 : 0.2, wet ? 1500 : 2600, wet ? 0.2 : 0.16, 'bandpass', wet ? 900 : 1700)
  }
  smoke(): void { this.burst(0.8, 3000, 0.35, 'bandpass', 300) }
  spotted(): void { this.tone(620, 0, 0.12, 'sawtooth', 0.08, 900) }
  caught(): void { this.burst(0.5, 900, 0.6); this.tone(90, 0, 0.4, 'sine', 0.4, 40) }
  exitOpen(): void { [523, 659, 784].forEach((f, i) => this.tone(f, i * 0.09, 0.22, 'triangle', 0.16)) }
  escape(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.3, 'triangle', 0.18)) }
  busted(): void { [392, 330, 262].forEach((f, i) => this.tone(f, i * 0.18, 0.35, 'sawtooth', 0.12)) }
  click(): void { this.tone(660, 0, 0.05, 'square', 0.08) }

  /** Silence the continuous sounds (engine, siren) without closing audio. */
  quiet(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.engineGain?.gain.setTargetAtTime(0, t, 0.05)
    this.sirenGain?.gain.setTargetAtTime(0, t, 0.05)
    this.sirenOn = false
  }

  dispose(): void {
    try { this.engineOsc?.stop(); this.sirenOsc?.stop() } catch { /* already stopped */ }
    void this.ctx?.close()
    this.ctx = null
  }
}

let shared: Sfx | null = null

/**
 * One audio engine for the whole page. It must be unlocked (resume()) inside a
 * user gesture, and the gesture that starts a run (the "Start run" click)
 * happens before the game component exists, so the audio cannot live inside it.
 */
export function getSfx(): Sfx | null {
  if (typeof window === 'undefined') return null
  if (!shared) shared = new Sfx()
  return shared
}

/** Unlock audio on the next click/tap/key anywhere on the page (safety net for strict browsers). */
export function unlockOnNextGesture(): () => void {
  const fn = () => getSfx()?.resume()
  const opts = { capture: true } as const
  window.addEventListener('pointerdown', fn, opts)
  window.addEventListener('keydown', fn, opts)
  return () => {
    window.removeEventListener('pointerdown', fn, opts)
    window.removeEventListener('keydown', fn, opts)
  }
}
