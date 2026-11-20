/**
 * Low-poly car models built from primitives (original designs, no assets).
 * Local frame: +X is forward, +Y up. About 0.82 x 0.44 tiles.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const wheelGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14)
wheelGeo.rotateX(Math.PI / 2)
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 })
const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 })
const rimGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.065, 10)
rimGeo.rotateX(Math.PI / 2)
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c1118, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05,
})
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 3 })
const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 2.2 })

/**
 * Silhouette drawn ONLY where the car is hidden behind something (depth test
 * reversed), so a car behind a building shows through as a coloured outline.
 */
export function addXray(group: THREE.Group, color: number): void {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.75, depthWrite: false, depthFunc: THREE.GreaterDepth,
  })
  const shape = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.3, 0.48, 2, 0.06), mat)
  shape.position.y = 0.18
  shape.renderOrder = 10
  group.add(shape)
}

export interface CarParts {
  group: THREE.Group
  /** Present on police cars: the two light-bar halves. */
  sirens?: { red: THREE.Mesh; blue: THREE.Mesh; light: THREE.PointLight }
  headlight?: THREE.SpotLight
}

function wheels(group: THREE.Group) {
  for (const [x, z] of [[0.24, 0.2], [0.24, -0.2], [-0.24, 0.2], [-0.24, -0.2]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat)
    w.position.set(x, 0.075, z)
    w.castShadow = true
    group.add(w)
    const r = new THREE.Mesh(rimGeo, rimMat)
    r.position.copy(w.position)
    group.add(r)
  }
}

function lights(group: THREE.Group) {
  const hl = new THREE.BoxGeometry(0.02, 0.035, 0.08)
  for (const z of [0.14, -0.14]) {
    const h = new THREE.Mesh(hl, headMat); h.position.set(0.415, 0.15, z); group.add(h)
    const t = new THREE.Mesh(hl, tailMat); t.position.set(-0.415, 0.16, z); group.add(t)
  }
}

export function makeGetawayCar(): CarParts {
  const group = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xff6a00, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  })
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.16, 0.44, 3, 0.05), paint)
  body.position.y = 0.15
  body.castShadow = true
  group.add(body)
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.13, 0.38, 3, 0.05), glassMat)
  cabin.position.set(-0.04, 0.27, 0)
  cabin.castShadow = true
  group.add(cabin)
  // Racing stripes.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.83, 0.005, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }))
  stripe.position.set(0, 0.233, 0.06); group.add(stripe)
  const stripe2 = stripe.clone(); stripe2.position.z = -0.06; group.add(stripe2)
  wheels(group)
  lights(group)

  const headlight = new THREE.SpotLight(0xfff2d0, 6, 7, Math.PI / 6, 0.5, 1.2)
  headlight.position.set(0.4, 0.2, 0)
  headlight.target.position.set(3, 0, 0)
  group.add(headlight, headlight.target)
  addXray(group, 0xff8a1f)
  return { group, headlight }
}

export function makePoliceCar(): CarParts {
  const group = new THREE.Group()
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f6fa, metalness: 0.3, roughness: 0.3, clearcoat: 0.8 })
  const black = new THREE.MeshPhysicalMaterial({ color: 0x14181f, metalness: 0.4, roughness: 0.35, clearcoat: 0.8 })
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.16, 0.44, 3, 0.05), black)
  body.position.y = 0.15
  body.castShadow = true
  group.add(body)
  // White doors (classic two-tone).
  const doors = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.165, 0.445, 2, 0.03), white)
  doors.position.set(-0.02, 0.152, 0)
  group.add(doors)
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.13, 0.38, 3, 0.05), glassMat)
  cabin.position.set(-0.03, 0.27, 0)
  cabin.castShadow = true
  group.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.34), white)
  roof.position.set(-0.03, 0.34, 0)
  group.add(roof)
  // Light bar.
  const barGeo = new THREE.BoxGeometry(0.07, 0.045, 0.14)
  const red = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1030, emissiveIntensity: 0 }))
  red.position.set(-0.03, 0.37, 0.075)
  const blue = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({ color: 0x000a40, emissive: 0x1a5cff, emissiveIntensity: 0 }))
  blue.position.set(-0.03, 0.37, -0.075)
  group.add(red, blue)
  const light = new THREE.PointLight(0xff1030, 0, 3.5, 1.6)
  light.position.set(-0.03, 0.6, 0)
  group.add(light)
  wheels(group)
  lights(group)
  addXray(group, 0x8fb8ff)
  return { group, sirens: { red, blue, light } }
}
