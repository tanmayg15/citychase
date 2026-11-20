/**
 * Procedural textures (no image downloads): building facades with window
 * grids, soft glow blobs, smoke puffs. Deterministic per seed so a city looks
 * the same every time.
 */
import * as THREE from 'three'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Facade albedo (concrete + dark glass) and an emissive map of lit windows. */
export function facadeTextures(seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 512, cols = 8, rows = 8
  const cw = size / cols, ch = size / rows
  const a = document.createElement('canvas'); a.width = a.height = size
  const e = document.createElement('canvas'); e.width = e.height = size
  const ac = a.getContext('2d')!, ec = e.getContext('2d')!
  const r = rng(seed)

  ac.fillStyle = '#c9c4bb'
  ac.fillRect(0, 0, size, size)
  // Concrete grain.
  for (let i = 0; i < 4000; i++) {
    const v = 180 + Math.floor(r() * 40)
    ac.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`
    ac.fillRect(r() * size, r() * size, 2, 2)
  }
  ec.fillStyle = '#000'
  ec.fillRect(0, 0, size, size)

  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = x * cw + cw * 0.18, py = y * ch + ch * 0.2, w = cw * 0.64, h = ch * 0.55
    // Glass with a sky reflection gradient.
    const g = ac.createLinearGradient(px, py, px, py + h)
    g.addColorStop(0, '#5a6b82'); g.addColorStop(1, '#1b2230')
    ac.fillStyle = g
    ac.fillRect(px, py, w, h)
    ac.fillStyle = 'rgba(255,255,255,0.12)'
    ac.fillRect(px, py, w * 0.3, h)
    // Frame.
    ac.strokeStyle = '#8a857c'; ac.lineWidth = 2; ac.strokeRect(px, py, w, h)
    // Some windows lit, warm or cool.
    if (r() < 0.42) {
      const warm = r() < 0.75
      ec.fillStyle = warm ? `hsl(${35 + r() * 15}, 90%, ${55 + r() * 15}%)` : `hsl(${195 + r() * 20}, 70%, 70%)`
      ec.fillRect(px, py, w, h)
      // Blinds / silhouettes for variety.
      if (r() < 0.4) { ec.fillStyle = 'rgba(0,0,0,0.5)'; ec.fillRect(px, py, w, h * (0.2 + r() * 0.5)) }
    }
  }
  // Floor slabs.
  ac.fillStyle = 'rgba(60,55,50,0.35)'
  for (let y = 0; y < rows; y++) ac.fillRect(0, y * ch, size, 4)

  const map = new THREE.CanvasTexture(a)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.anisotropy = 8
  const emissive = new THREE.CanvasTexture(e)
  emissive.colorSpace = THREE.SRGBColorSpace
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping
  return { map, emissive }
}

/** Rooftop: gravel with vents and AC units. */
export function roofTexture(seed: number): THREE.CanvasTexture {
  const size = 256
  const c = document.createElement('canvas'); c.width = c.height = size
  const x = c.getContext('2d')!
  const r = rng(seed)
  x.fillStyle = '#4a4d52'; x.fillRect(0, 0, size, size)
  for (let i = 0; i < 3000; i++) {
    const v = 60 + Math.floor(r() * 50)
    x.fillStyle = `rgb(${v},${v},${v + 4})`
    x.fillRect(r() * size, r() * size, 2, 2)
  }
  for (let i = 0; i < 6; i++) {
    x.fillStyle = '#8b9096'
    const w = 16 + r() * 30, h = 12 + r() * 20
    x.fillRect(r() * (size - w), r() * (size - h), w, h)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Asphalt with fine noise and a few cracks. */
export function asphaltTexture(): THREE.CanvasTexture {
  const size = 512
  const c = document.createElement('canvas'); c.width = c.height = size
  const x = c.getContext('2d')!
  const r = rng(7)
  x.fillStyle = '#2b2d31'; x.fillRect(0, 0, size, size)
  for (let i = 0; i < 20000; i++) {
    const v = 30 + Math.floor(r() * 30)
    x.fillStyle = `rgba(${v},${v},${v + 3},0.6)`
    x.fillRect(r() * size, r() * size, 1.5, 1.5)
  }
  x.strokeStyle = 'rgba(15,15,18,0.6)'
  for (let i = 0; i < 12; i++) {
    x.beginPath()
    let px = r() * size, py = r() * size
    x.moveTo(px, py)
    for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py) }
    x.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Radial glow for fake light pools (street lamps, sirens, loot). */
export function glowTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas'); c.width = c.height = size
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
