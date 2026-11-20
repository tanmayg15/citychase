/**
 * Seeded PRNG (mulberry32). Pure integer math, so it gives identical results in
 * every JS runtime. State is a single uint32 kept inside GameState.
 */
export function nextRng(state: number): [value: number, nextState: number] {
  const s = (state + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [(t ^ (t >>> 14)) >>> 0, s]
}

/** Integer in [0, n). */
export function rngInt(state: number, n: number): [value: number, nextState: number] {
  const [v, s] = nextRng(state)
  return [v % n, s]
}

/** Derive a daily seed from a YYYY-MM-DD string (FNV-1a). */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
