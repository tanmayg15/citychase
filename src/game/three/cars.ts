/**
 * Car models: original "exotic supercar" designs built from extruded side
 * profiles (no assets, no real brands): a low wedge body, a teardrop glass
 * canopy, side intakes, a front splitter, a big rear wing, wide wheels, LED
 * light strips. The getaway car is metallic orange; the police use the same
 * platform as a black-and-white interceptor with a light bar.
 * Local frame: +X is forward, +Y up, about 0.86 × 0.46 tiles.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// ─── Shared parts ───────────────────────────────────────────────────────────

const tyreGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.075, 20).rotateX(Math.PI / 2)
const rimGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.078, 10).rotateX(Math.PI / 2)
const hubGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.082, 8).rotateX(Math.PI / 2)
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 })
const rimMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.95, roughness: 0.25 })
const hubMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.2 })
const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.4, roughness: 0.45 })
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x05080d, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03,
})
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 4 })
const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a1a, emissiveIntensity: 3 })

/** Wedge body: side profile (x forward, y up) extruded across the car's width. */
const BODY_PROFILE: Array<[number, number]> = [
  [0.44, 0.055], [0.445, 0.085], [0.40, 0.105], [0.28, 0.135], [0.14, 0.16],
  [-0.20, 0.185], [-0.36, 0.18], [-0.43, 0.165], [-0.44, 0.12], [-0.43, 0.06], [0.40, 0.045],
]
/** Teardrop canopy (glass), sits on the body's spine. */
const CANOPY_PROFILE: Array<[number, number]> = [
  [0.17, 0.15], [0.05, 0.245], [-0.08, 0.262], [-0.22, 0.225], [-0.30, 0.185], [-0.30, 0.17], [0.17, 0.14],
]

function extrude(profile: Array<[number, number]>, width: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  profile.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4,
  })
  g.translate(0, 0, -(width - bevel * 2) / 2)
  return g
}

const bodyGeo = extrude(BODY_PROFILE, 0.46, 0.022)
const canopyGeo = extrude(CANOPY_PROFILE, 0.32, 0.03)

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}

/** Silhouette drawn ONLY where the car is hidden behind something (reversed depth test). */
export function addXray(group: THREE.Group, color: number): void {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.75, depthWrite: false, depthFunc: THREE.GreaterDepth,
  })
  const shape = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.28, 0.5, 2, 0.06), mat)
  shape.position.y = 0.16
  shape.renderOrder = 10
  group.add(shape)
}

export interface CarParts {
  group: THREE.Group
  /** Present on police cars: the two light-bar halves. */
  sirens?: { red: THREE.Mesh; blue: THREE.Mesh; light: THREE.PointLight }
  headlight?: THREE.SpotLight
}

/** The shared supercar platform. `livery` paints extra panels on top. */
function supercar(paint: THREE.Material, accent: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(bodyGeo, paint)
  body.castShadow = true
  g.add(body)
  const canopy = new THREE.Mesh(canopyGeo, glassMat)
  canopy.castShadow = true
  g.add(canopy)

  // Aero: splitter, side skirts, side intakes, diffuser, rear wing on two struts.
  g.add(box(0.07, 0.012, 0.47, carbonMat, 0.43, 0.048, 0))
  for (const z of [0.236, -0.236]) {
    g.add(box(0.5, 0.025, 0.012, carbonMat, -0.02, 0.06, z))
    g.add(box(0.15, 0.055, 0.012, accent, -0.12, 0.12, z))
  }
  g.add(box(0.04, 0.03, 0.4, carbonMat, -0.44, 0.07, 0))
  for (const z of [0.12, -0.12]) g.add(box(0.025, 0.07, 0.018, carbonMat, -0.38, 0.215, z))
  const wing = box(0.1, 0.014, 0.5, accent, -0.39, 0.255, 0)
  wing.castShadow = true
  g.add(wing)
  for (const z of [0.25, -0.25]) g.add(box(0.11, 0.05, 0.008, accent, -0.39, 0.24, z))

  // Lights: thin LED headlight strips, full-width tail bar, twin exhausts.
  for (const z of [0.16, -0.16]) {
    const h = box(0.03, 0.012, 0.11, headMat, 0.42, 0.098, z)
    h.rotation.y = z > 0 ? -0.25 : 0.25
    g.add(h)
  }
  g.add(box(0.008, 0.016, 0.4, tailMat, -0.444, 0.15, 0))
  for (const z of [0.05, -0.05]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10).rotateZ(Math.PI / 2), hubMat)
    ex.position.set(-0.45, 0.075, z)
    g.add(ex)
  }

  // Wide wheels with dark rims and bright hubs.
  for (const [x, z] of [[0.27, 0.215], [0.27, -0.215], [-0.27, 0.215], [-0.27, -0.215]]) {
    const t = new THREE.Mesh(tyreGeo, tyreMat)
    t.position.set(x, 0.088, z)
    t.castShadow = true
    const r = new THREE.Mesh(rimGeo, rimMat); r.position.copy(t.position)
    const h = new THREE.Mesh(hubGeo, hubMat); h.position.copy(t.position)
    g.add(t, r, h)
  }
  return g
}

export function makeGetawayCar(): CarParts {
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xff5a00, metalness: 0.7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05,
  })
  const group = supercar(paint, carbonMat)
  // Twin black racing stripes over the hood and roofline.
  for (const z of [0.045, -0.045]) group.add(box(0.5, 0.004, 0.035, carbonMat, 0.17, 0.152, z))

  const headlight = new THREE.SpotLight(0xf2f7ff, 6, 7, Math.PI / 6, 0.5, 1.2)
  headlight.position.set(0.42, 0.12, 0)
  headlight.target.position.set(3, 0, 0)
  group.add(headlight, headlight.target)
  addXray(group, 0xff8a1f)
  return { group, headlight }
}

export function makePoliceCar(): CarParts {
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, metalness: 0.35, roughness: 0.25, clearcoat: 1 })
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0c0f15, metalness: 0.5, roughness: 0.3, clearcoat: 1 })
  const group = supercar(black, white)
  // Interceptor livery: white door panels and a blue stripe.
  const stripe = new THREE.MeshStandardMaterial({ color: 0x1f5fff, emissive: 0x0a2a80, emissiveIntensity: 0.4 })
  for (const z of [0.231, -0.231]) {
    group.add(box(0.36, 0.06, 0.006, white, 0.04, 0.115, z))
    group.add(box(0.36, 0.012, 0.008, stripe, 0.04, 0.145, z))
  }
  // Low-profile light bar across the canopy.
  const barGeo = new THREE.BoxGeometry(0.05, 0.025, 0.13)
  const red = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1030, emissiveIntensity: 0 }))
  red.position.set(-0.06, 0.275, 0.066)
  const blue = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x000a40, emissive: 0x1a5cff, emissiveIntensity: 0 }))
  blue.position.set(-0.06, 0.275, -0.066)
  group.add(red, blue)
  const light = new THREE.PointLight(0xff1030, 0, 3.5, 1.6)
  light.position.set(-0.06, 0.55, 0)
  group.add(light)
  addXray(group, 0x8fb8ff)
  return { group, sirens: { red, blue, light } }
}
