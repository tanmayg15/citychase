/**
 * 3D renderer for City Chase (Three.js). Render-only: it reads the engine's
 * GameState and the smoothed positions from Motion, and never feeds anything
 * back, so the server replay is unaffected by what is drawn here.
 *
 * World units: 1 tile = 1 unit. Maze x → world X, maze y → world Z.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { beamTiles, Cell, Dir, type GameConfig, type GameState, type WeatherSnapshot } from '../../engine'
import type { Pos } from '../motion'
import { makeGetawayCar, makePoliceCar, type CarParts } from './cars'
import { asphaltTexture, facadeTextures, glowTexture, roofTexture } from './textures'

const YAW = [0, Math.PI / 2, 0, -Math.PI / 2, Math.PI] // Dir → rotation.y (+X forward)
const INSET = 0.14 // sidewalk width between road and building face
const FACADE_TINTS = [0xd9cfc0, 0xb8b2a6, 0xa86b54, 0x8fa3b5, 0xe8e4dc, 0x9c8f7c, 0x7f8c8d, 0xc2a68a]

function hash(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Connected building tiles share a block id. */
function blockIds(cfg: GameConfig): Int32Array {
  const { width: w, height: h, cells } = cfg.maze
  const ids = new Int32Array(w * h).fill(-1)
  let next = 0
  for (let s = 0; s < w * h; s++) {
    if (cells[s] !== Cell.Wall || ids[s] !== -1) continue
    const stack = [s]
    ids[s] = next
    while (stack.length) {
      const k = stack.pop()!
      const x = k % w, y = Math.floor(k / w)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const n = ny * w + nx
        if (cells[n] === Cell.Wall && ids[n] === -1) { ids[n] = next; stack.push(n) }
      }
    }
    next++
  }
  return ids
}

class GeoBuilder {
  pos: number[] = []
  norm: number[] = []
  uv: number[] = []
  col: number[] = []
  idx: number[] = []
  quad(v: number[][], n: number[], uvs: number[][], c: THREE.Color) {
    const base = this.pos.length / 3
    for (let i = 0; i < 4; i++) {
      this.pos.push(...v[i]); this.norm.push(...n); this.uv.push(...uvs[i]); this.col.push(c.r, c.g, c.b)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    return g
  }
}

export class CityScene {
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  private camTarget = new THREE.Vector3()
  private player: CarParts
  private cops: CarParts[] = []
  private copYaw: number[] = []
  private playerYaw = 0
  private loot: THREE.Mesh[] = []
  private lootGlow: THREE.Sprite[] = []
  private smokes: THREE.Group[] = []
  private puffs: THREE.Sprite[][] = []
  private safehouse!: { door: THREE.MeshStandardMaterial; beam: THREE.Mesh; ring: THREE.Mesh }
  private beams!: THREE.InstancedMesh
  private rain: THREE.LineSegments | null = null
  private lastMs = 0
  private disposables: Array<{ dispose(): void }> = []
  private readonly night: boolean

  constructor(canvas: HTMLCanvasElement, private cfg: GameConfig, weather: WeatherSnapshot) {
    this.night = weather.isNight
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.night ? 0.9 : 1.05

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environment = env
    this.disposables.push(env, pmrem)

    this.setupAtmosphere(weather)
    this.buildCity(weather)
    this.buildProps()

    this.player = makeGetawayCar()
    this.player.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.renderOrder === 0) o.castShadow = true })
    if (this.player.headlight) this.player.headlight.intensity = this.night ? 14 : 4
    this.scene.add(this.player.group)
    for (let i = 0; i < cfg.plan.cops.length; i++) {
      const c = makePoliceCar()
      this.cops.push(c)
      this.copYaw.push(-Math.PI / 2)
      this.scene.add(c.group)
    }

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.night ? 0.55 : 0.35, 0.45, this.night ? 0.78 : 0.95)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    const sp = cfg.maze.playerSpawn
    this.camTarget.set(sp.x + 0.5, 0, sp.y + 0.5)
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  private setupAtmosphere(w: WeatherSnapshot) {
    const overcast = w.condition !== 'clear'
    const sky = this.night ? 0x0a0f1e : overcast ? 0x9aa3ad : 0xa9c8e8
    this.scene.background = new THREE.Color(sky)
    const fogNear = w.condition === 'mist' ? 10 : this.night ? 16 : 26
    const fogFar = w.condition === 'mist' ? 26 : this.night ? 34 : 60
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar)

    const hemi = new THREE.HemisphereLight(this.night ? 0x334466 : 0xdfeaff, this.night ? 0x0a0a12 : 0x3a3530,
      this.night ? 0.35 : overcast ? 1.1 : 0.9)
    this.scene.add(hemi)

    const { width: W, height: H } = this.cfg.maze
    const sun = new THREE.DirectionalLight(this.night ? 0x8899cc : 0xfff1dc, this.night ? 0.35 : overcast ? 1.1 : 2.6)
    sun.position.set(W / 2 - 10, 22, H / 2 + 12)
    sun.target.position.set(W / 2, 0, H / 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const r = Math.max(W, H) / 2 + 4
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 70 })
    sun.shadow.bias = -0.0008
    sun.shadow.normalBias = 0.02
    this.scene.add(sun, sun.target)

    if (w.condition === 'rain' || w.condition === 'drizzle' || w.condition === 'thunderstorm' || w.condition === 'snow') {
      this.rain = this.makeRain(w.condition === 'snow')
      this.scene.add(this.rain)
    }
  }

  private buildCity(w: WeatherSnapshot) {
    const { width: W, height: H, cells } = this.cfg.maze
    const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cells[y * W + x] === Cell.Wall
    const open = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cells[y * W + x] !== Cell.Wall
    const ids = blockIds(this.cfg)

    // Height per 2x2 "lot" inside each block gives a varied skyline.
    const heightAt = (x: number, y: number): number => {
      if (!wall(x, y)) return 0
      const b = ids[y * W + x]
      const lot = (x >> 1) * 131 + (y >> 1)
      const r = hash(b * 7919 + lot, 3)
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1
      return edge ? 0.35 + r * 0.4 : 0.55 + r * r * 2.1
    }
    const tintAt = (x: number, y: number) => new THREE.Color(FACADE_TINTS[Math.floor(hash(ids[y * W + x] * 31 + (x >> 1) * 7 + (y >> 1), 9) * FACADE_TINTS.length)])

    const walls = new GeoBuilder(), roofs = new GeoBuilder(), walks = new GeoBuilder()
    const S = 0.4 // texture scale: window grid density
    const white = new THREE.Color(1, 1, 1)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!wall(x, y)) continue
      const h = heightAt(x, y)
      const c = tintAt(x, y)
      const x0 = x + (open(x - 1, y) ? INSET : 0), x1 = x + 1 - (open(x + 1, y) ? INSET : 0)
      const z0 = y + (open(x, y - 1) ? INSET : 0), z1 = y + 1 - (open(x, y + 1) ? INSET : 0)
      // Sidewalk slab under every building tile.
      walks.quad([[x, 0.035, y], [x, 0.035, y + 1], [x + 1, 0.035, y + 1], [x + 1, 0.035, y]], [0, 1, 0],
        [[x, y], [x, y + 1], [x + 1, y + 1], [x + 1, y]], white)
      // Roof.
      roofs.quad([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0],
        [[x0 * 0.5, z0 * 0.5], [x0 * 0.5, z1 * 0.5], [x1 * 0.5, z1 * 0.5], [x1 * 0.5, z0 * 0.5]], c)
      // Sides: only where the neighbour is road or a lower lot.
      const sides: Array<[number, number, number[]]> = [[-1, 0, [-1, 0, 0]], [1, 0, [1, 0, 0]], [0, -1, [0, 0, -1]], [0, 1, [0, 0, 1]]]
      for (const [dx, dy, n] of sides) {
        const nh = wall(x + dx, y + dy) ? heightAt(x + dx, y + dy) : 0
        if (nh >= h) continue
        const yb = nh
        if (dx !== 0) {
          const fx = dx < 0 ? x0 : x1
          walls.quad([[fx, yb, z0], [fx, yb, z1], [fx, h, z1], [fx, h, z0]], n,
            [[z0 * S, yb * S], [z1 * S, yb * S], [z1 * S, h * S], [z0 * S, h * S]], c)
        } else {
          const fz = dy < 0 ? z0 : z1
          walls.quad([[x0, yb, fz], [x1, yb, fz], [x1, h, fz], [x0, h, fz]], n,
            [[x0 * S, yb * S], [x1 * S, yb * S], [x1 * S, h * S], [x0 * S, h * S]], c)
        }
      }
    }

    const facade = facadeTextures(42)
    const wallMat = new THREE.MeshStandardMaterial({
      map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff,
      emissiveIntensity: this.night ? 0.85 : 0.12, vertexColors: true, roughness: 0.7, metalness: 0.05,
      side: THREE.DoubleSide,
    })
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(5), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x8d8f93, roughness: 0.9 })
    for (const [b, m] of [[walls, wallMat], [roofs, roofMat], [walks, walkMat]] as const) {
      const mesh = new THREE.Mesh(b.build(), m)
      mesh.castShadow = b !== walks
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }

    // Road surface (wet when raining: glossy and reflective).
    const wet = w.condition === 'rain' || w.condition === 'drizzle' || w.condition === 'thunderstorm'
    const asphalt = asphaltTexture()
    asphalt.repeat.set((W + 40) / 4, (H + 40) / 4)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 40, H + 40),
      new THREE.MeshStandardMaterial({
        map: asphalt, roughness: wet ? 0.18 : 0.92, metalness: wet ? 0.35 : 0.0,
        envMapIntensity: wet ? 1.4 : 0.4, color: w.condition === 'snow' ? 0xd8dde4 : 0xffffff,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(W / 2, 0, H / 2)
    ground.receiveShadow = true
    this.scene.add(ground)

    // Lane dashes and crosswalks as instanced thin boxes.
    const marks: THREE.Matrix4[] = []
    const zebra: THREE.Matrix4[] = []
    const m4 = (px: number, pz: number, sx: number, sz: number) =>
      new THREE.Matrix4().compose(new THREE.Vector3(px, 0.012, pz), new THREE.Quaternion(), new THREE.Vector3(sx, 1, sz))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!open(x, y)) continue
      const lr = open(x - 1, y) || open(x + 1, y), ud = open(x, y - 1) || open(x, y + 1)
      const n = [open(x - 1, y), open(x + 1, y), open(x, y - 1), open(x, y + 1)].filter(Boolean).length
      if (n >= 3) {
        for (let i = 0; i < 3; i++) {
          const o = 0.3 + i * 0.2
          if (open(x, y - 1)) zebra.push(m4(x + o, y + 0.08, 0.09, 0.14))
          if (open(x, y + 1)) zebra.push(m4(x + o, y + 0.92, 0.09, 0.14))
          if (open(x - 1, y)) zebra.push(m4(x + 0.08, y + o, 0.14, 0.09))
          if (open(x + 1, y)) zebra.push(m4(x + 0.92, y + o, 0.14, 0.09))
        }
      } else if (lr && !ud) marks.push(m4(x + 0.5, y + 0.5, 0.42, 0.03))
      else if (ud && !lr) marks.push(m4(x + 0.5, y + 0.5, 0.03, 0.42))
    }
    const markGeo = new THREE.BoxGeometry(1, 0.004, 1)
    for (const [list, color] of [[marks, 0xb8962e], [zebra, 0x8f949b]] as const) {
      const im = new THREE.InstancedMesh(markGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), list.length)
      list.forEach((m, i) => im.setMatrixAt(i, m))
      im.receiveShadow = true
      this.scene.add(im)
    }

    // Street lamps on some junctions, with a fake light pool on the road.
    const glow = glowTexture()
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.75, 6)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.7, roughness: 0.4 })
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: this.night ? 4 : 0.3 })
    const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!open(x, y) || (x * 7 + y * 3) % 5 !== 0) continue
      const n = [open(x - 1, y), open(x + 1, y), open(x, y - 1), open(x, y + 1)].filter(Boolean).length
      if (n < 3) continue
      const pole = new THREE.Mesh(poleGeo, poleMat)
      pole.position.set(x + 0.06, 0.375, y + 0.06)
      pole.castShadow = true
      const bulb = new THREE.Mesh(bulbGeo, bulbMat)
      bulb.position.set(x + 0.06, 0.76, y + 0.06)
      this.scene.add(pole, bulb)
      if (this.night) {
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8),
          new THREE.MeshBasicMaterial({ map: glow, color: 0xffc777, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
        pool.rotation.x = -Math.PI / 2
        pool.position.set(x + 0.3, 0.02, y + 0.3)
        this.scene.add(pool)
      }
    }
  }

  private buildProps() {
    const s = this.cfg
    const glow = glowTexture()
    // Headlight beams of cops: thin additive planes on the road, coloured per instance.
    const beamMax = s.plan.cops.length * 12
    this.beams = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      beamMax,
    )
    this.beams.count = 0
    this.scene.add(this.beams)

    // Safehouse: small garage, a door that lights up, a beacon beam and a ground ring.
    const garage = new THREE.Group()
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }))
    shell.position.y = 0.225
    shell.castShadow = true
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x3dff9a, emissiveIntensity: 0 })
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.3, 0.5), doorMat)
    door.position.y = 0.16
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3dff9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = 4
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3dff9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    ring.position.y = 0.03
    garage.add(shell, door, beam, ring)
    this.safehouse = { door: doorMat, beam, ring }
    this.scene.add(garage)
    // Position set once the first state arrives (exit comes from the engine).
    garage.name = 'safehouse'

    // Loot: spinning gold gems with a glow sprite.
    const gemGeo = new THREE.OctahedronGeometry(0.17, 0)
    const gemMat = new THREE.MeshPhysicalMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.15, clearcoat: 1 })
    for (let i = 0; i < 16; i++) {
      const gem = new THREE.Mesh(gemGeo, gemMat)
      gem.castShadow = true
      gem.visible = false
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffc23a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
      sp.scale.set(0.9, 0.9, 1)
      sp.visible = false
      this.loot.push(gem); this.lootGlow.push(sp)
      this.scene.add(gem, sp)
    }

    // Smoke bomb canisters.
    const canGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 12)
    const canMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.6, roughness: 0.35 })
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x3dff9a, emissiveIntensity: 1.5 })
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group()
      const can = new THREE.Mesh(canGeo, canMat); can.position.y = 0.11; can.castShadow = true
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.04, 12), bandMat); band.position.y = 0.13
      g.add(can, band)
      g.visible = false
      this.smokes.push(g)
      this.scene.add(g)
    }

    // Smoke puffs that surround blinded cops.
    const puffMat = new THREE.SpriteMaterial({ map: glow, color: 0xcfd4dc, transparent: true, opacity: 0.55, depthWrite: false })
    for (let i = 0; i < s.plan.cops.length; i++) {
      const list: THREE.Sprite[] = []
      for (let k = 0; k < 6; k++) {
        const p = new THREE.Sprite(puffMat)
        p.scale.set(0.8, 0.8, 1)
        p.visible = false
        list.push(p)
        this.scene.add(p)
      }
      this.puffs.push(list)
    }
  }

  private makeRain(snow: boolean): THREE.LineSegments {
    const n = snow ? 1200 : 2200
    const pos = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 30, y = Math.random() * 14, z = (Math.random() - 0.5) * 24
      const len = snow ? 0.04 : 0.35
      pos.set([x, y, z, x + (snow ? 0.02 : 0.05), y - len, z], i * 6)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = new THREE.LineBasicMaterial({ color: snow ? 0xffffff : 0xaec6e0, transparent: true, opacity: snow ? 0.9 : 0.45 })
    const l = new THREE.LineSegments(g, m)
    l.userData.snow = snow
    l.frustumCulled = false
    return l
  }

  // ─── Per frame ────────────────────────────────────────────────────────────

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloom.resolution.set(width / 2, height / 2)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  /** Renders a frame; returns the getaway car's position on screen (0..1, 0..1). */
  render(s: GameState, pos: Pos[], timeMs: number): { x: number; y: number } {
    const dt = this.lastMs ? Math.min(0.1, (timeMs - this.lastMs) / 1000) : 0.016
    this.lastMs = timeMs
    const turn = (cur: number, target: number) => {
      let d = target - cur
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      return cur + d * Math.min(1, dt * 12)
    }

    // Getaway car.
    const pp = pos[0] ?? s.player
    this.player.group.position.set(pp.x + 0.5, 0, pp.y + 0.5)
    if (s.player.dir !== Dir.None) this.playerYaw = turn(this.playerYaw, YAW[s.player.dir])
    this.player.group.rotation.y = this.playerYaw

    // Police cars, light bars and smoke.
    const flip = Math.floor(timeMs / 140) % 2 === 0
    s.cops.forEach((c, i) => {
      const car = this.cops[i]
      if (!car) return
      const p = pos[i + 1] ?? c
      car.group.position.set(p.x + 0.5, 0, p.y + 0.5)
      if (c.status !== 'garage') this.copYaw[i] = turn(this.copYaw[i], YAW[c.dir])
      car.group.rotation.y = this.copYaw[i]
      const on = c.status === 'chase' || c.status === 'search'
      const sir = car.sirens!
      ;(sir.red.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? (flip ? 6 : 0.3) : 0.2
      ;(sir.blue.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? (flip ? 0.3 : 6) : 0.2
      sir.light.intensity = on ? (this.night ? 9 : 4) : 0
      sir.light.color.set(flip ? 0xff1030 : 0x1a5cff)
      this.puffs[i].forEach((sp, k) => {
        sp.visible = c.status === 'blind'
        if (!sp.visible) return
        const a = timeMs / 900 + k * 1.05
        sp.position.set(p.x + 0.5 + Math.cos(a) * 0.35, 0.3 + (k % 3) * 0.12, p.y + 0.5 + Math.sin(a) * 0.3)
      })
    })

    // Headlight beams (red while chasing).
    let n = 0
    const m = new THREE.Matrix4(), col = new THREE.Color()
    s.cops.forEach((c) => {
      if (c.status === 'garage' || c.status === 'blind') return
      col.set(c.status === 'chase' ? 0xff3344 : 0xfff0b0)
      for (const t of beamTiles(this.cfg.maze, c.x, c.y, c.dir, this.cfg.modifiers.copVision)) {
        if (n >= this.beams.instanceMatrix.count) break
        m.makeTranslation(t.x + 0.5, 0.02, t.y + 0.5)
        this.beams.setMatrixAt(n, m)
        this.beams.setColorAt(n, col)
        n++
      }
    })
    this.beams.count = n
    this.beams.instanceMatrix.needsUpdate = true
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true

    // Loot, smoke canisters, safehouse.
    const bob = Math.sin(timeMs / 300) * 0.04
    this.loot.forEach((g, i) => {
      const l = s.loot[i]
      const show = !!l && !l.taken
      g.visible = show
      this.lootGlow[i].visible = show
      if (!show) return
      g.position.set(l.x + 0.5, 0.3 + bob, l.y + 0.5)
      g.rotation.y = timeMs / 600
      this.lootGlow[i].position.set(l.x + 0.5, 0.3, l.y + 0.5)
    })
    this.smokes.forEach((g, i) => {
      const b = s.smokes[i]
      g.visible = !!b && !b.taken
      if (b) g.position.set(b.x + 0.5, 0, b.y + 0.5)
    })
    const sh = this.scene.getObjectByName('safehouse')!
    sh.position.set(s.exit.x + 0.5, 0, s.exit.y + 0.5)
    this.safehouse.door.emissiveIntensity = s.exit.open ? 3 : 0
    ;(this.safehouse.beam.material as THREE.MeshBasicMaterial).opacity = s.exit.open ? 0.18 + 0.06 * Math.sin(timeMs / 200) : 0
    const ringT = (timeMs / 1000) % 1
    ;(this.safehouse.ring.material as THREE.MeshBasicMaterial).opacity = s.exit.open ? 1 - ringT : 0
    this.safehouse.ring.scale.setScalar(1 + ringT * 1.5)

    // Rain / snow follows the camera.
    if (this.rain) {
      const a = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = a.array as Float32Array
      const fall = (this.rain.userData.snow ? 1.2 : 14) * dt
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= fall; arr[i + 4] -= fall
        if (arr[i + 4] < 0) { arr[i + 1] += 14; arr[i + 4] += 14 }
      }
      a.needsUpdate = true
      this.rain.position.set(this.camTarget.x, 0, this.camTarget.z)
    }

    // Chase camera: follows the car from behind-and-above, north stays up so
    // the arrow keys keep matching the screen.
    const { width: MW, height: MH } = this.cfg.maze
    // Keep the car near the middle of the screen; clamp only a little at the
    // map edges (a hard clamp pushed the car to the screen edge, where it was
    // seen at a shallow angle behind buildings).
    const goal = new THREE.Vector3(
      THREE.MathUtils.clamp(pp.x + 0.5, 3, MW - 3),
      0,
      THREE.MathUtils.clamp(pp.y + 0.5, 1.5, MH - 3),
    )
    this.camTarget.lerp(goal, 1 - Math.exp(-dt * 5))
    this.camera.position.set(this.camTarget.x, 13, this.camTarget.z + 6.2)
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 0.6)

    this.composer.render()
    const v = this.player.group.position.clone().project(this.camera)
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }
  }

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose()
        mm.dispose()
      }
    })
    for (const d of this.disposables) d.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
