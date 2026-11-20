/**
 * Loads the CC0 Kenney models in public/models (license: public/models/LICENSE-kenney-cc0.txt)
 * once per page. Each model is flattened into a list of (geometry, material)
 * parts in model space, so the city can draw hundreds of copies with
 * InstancedMesh (one draw call per part type).
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface ModelParts {
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>
  /** Bounding box size in model units. */
  size: THREE.Vector3
}

export interface Models {
  race: THREE.Group
  police: THREE.Group
  buildings: ModelParts[]
  skyscrapers: ModelParts[]
  trees: ModelParts[]
  bushes: ModelParts[]
  trafficLight: ModelParts
  streetLight: ModelParts
}

const BUILDINGS = 'abcdefghijklmn'.split('').map((c) => `city/building-${c}.glb`)
const SKYSCRAPERS = 'abcde'.split('').map((c) => `city/building-skyscraper-${c}.glb`)
const TREES = ['tree_default', 'tree_oak', 'tree_detailed', 'tree_cone', 'tree_fat'].map((t) => `nature/${t}.glb`)
const BUSHES = ['plant_bush', 'plant_bushLarge'].map((t) => `nature/${t}.glb`)

/** Flatten a glTF scene into world-space geometries merged per material. */
function toParts(root: THREE.Object3D): ModelParts {
  root.updateMatrixWorld(true)
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
    // Keep only the attributes every part shares so merging never fails.
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
    const mat = mats[0]
    const list = byMat.get(mat) ?? []
    list.push(g)
    byMat.set(mat, list)
  })
  const parts: ModelParts['parts'] = []
  for (const [material, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
    if (merged) parts.push({ geometry: merged, material })
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
  return { parts, size }
}

/**
 * The kit's pastel colormap was authored for flat, unlit-looking scenes; under
 * our sun + sky light + environment reflections it blows out to white. Tone
 * each material down once so it sits in the same exposure as the rest.
 */
let leafIndex = 0

function tame<T extends THREE.Object3D>(root: T): T {
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (seen.has(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue
      seen.add(mat)
      // The nature kit's foliage is a stylised mint/teal; use natural greens instead.
      if (/^leaf/i.test(mat.name)) {
        const greens = [0x3e7a2c, 0x4a8a32, 0x356b28, 0x5b8f3a]
        mat.color.setHex(greens[leafIndex++ % greens.length])
        mat.envMapIntensity = 0.2
        mat.roughness = 0.9
        continue
      }
      mat.color.multiplyScalar(0.62)
      mat.envMapIntensity = 0.25
      mat.roughness = Math.max(mat.roughness, 0.75)
      mat.metalness = 0
    }
  })
  return root
}

// Every model in a kit points at the same Textures/colormap.png. Without the
// shared cache each GLB fetched and decoded its own copy (23 requests, ~0.8 s).
THREE.Cache.enabled = true

let cache: Promise<Models> | null = null

export function loadModels(base = '/models/'): Promise<Models> {
  if (cache) return cache
  const loader = new GLTFLoader()
  const load = (path: string) => loader.loadAsync(base + path).then((g) => tame(g.scene))
  cache = (async () => {
    const [race, police, buildings, skyscrapers, trees, bushes, trafficLight, streetLight] = await Promise.all([
      load('cars/race.glb'),
      load('cars/police.glb'),
      Promise.all(BUILDINGS.map(load)),
      Promise.all(SKYSCRAPERS.map(load)),
      Promise.all(TREES.map(load)),
      Promise.all(BUSHES.map(load)),
      load('city/traffic-light.glb'),
      load('city/light-curved.glb'),
    ])
    return {
      race, police,
      buildings: buildings.map(toParts),
      skyscrapers: skyscrapers.map(toParts),
      trees: trees.map(toParts),
      bushes: bushes.map(toParts),
      trafficLight: toParts(trafficLight),
      streetLight: toParts(streetLight),
    }
  })()
  cache.catch(() => { cache = null })
  return cache
}
