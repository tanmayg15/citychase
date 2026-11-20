#!/usr/bin/env node
/**
 * OFFLINE step 2: turn raw OSM street lines into playable grid mazes.
 *
 *   node scripts/mazes/build-mazes.mjs
 *
 * Pipeline per city:
 *  1. Project lat/lon to local metres around the centre point.
 *  2. Rotate so the dominant street bearing lines up with the grid axes
 *     (otherwise Manhattan/Eixample turn into staircases).
 *  3. Lay a NX x NY lattice of street "nodes" (CELL_M metres apart) over the
 *     area and trace every street through it, joining neighbouring nodes.
 *     Node (i,j) becomes grid tile (2i+1, 2j+1); a joined pair opens the
 *     tile between them. This always gives 1-tile corridors with walls between.
 *  4. Keep the largest connected piece and repeatedly remove dead ends.
 *  5. Place ghost spawns near the centre, the player far from them, a power
 *     core near each corner, and orbs everywhere else.
 * Output: src/cities/data/<id>.json (committed; shipped in the bundle).
 * Deterministic: same raw input, same output.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { CITIES, RADIUS_M } from './cities.mjs'

const NX = 15
const NY = 11
const CELL_M = (2 * RADIUS_M) / NX // 100 m between nodes
const W = 2 * NX + 1
const H = 2 * NY + 1

/** How much each road class counts toward opening a corridor. */
const ROAD_WEIGHT = { primary: 2, secondary: 2, tertiary: 1.5, residential: 1, unclassified: 0.7, living_street: 0.5, pedestrian: 0.5 }
/** Weighted metres of street needed between two nodes to open a corridor. */
const MIN_SUPPORT = Number(process.env.MIN_SUPPORT ?? 0.5) * CELL_M

const outDir = new URL('../../src/cities/data/', import.meta.url)

function project(lat, lon, c) {
  const k = 111_320
  return [(lon - c.lon) * k * Math.cos((c.lat * Math.PI) / 180), -(lat - c.lat) * k]
}

/** Length-weighted mode of street bearings modulo 90°, in degrees. */
function dominantBearing(lines) {
  const bins = new Array(90).fill(0)
  for (const pts of lines) {
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0]
      const dy = pts[i][1] - pts[i - 1][1]
      const len = Math.hypot(dx, dy)
      if (len < 1) continue
      const deg = (((Math.atan2(dy, dx) * 180) / Math.PI) % 90 + 90) % 90
      bins[Math.floor(deg) % 90] += len
    }
  }
  let best = 0, bestV = -1
  for (let b = 0; b < 90; b++) {
    const v = bins[(b + 89) % 90] + bins[b] + bins[(b + 1) % 90] // smooth over ±1°
    if (v > bestV) { bestV = v; best = b }
  }
  return best + 0.5
}

function rotate([x, y], deg) {
  const r = (-deg * Math.PI) / 180
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
}

const key = (i, j) => j * NX + i

function buildCity(c, raw) {
  const lines = raw.ways.map((w) => w.geometry.map(([lat, lon]) => project(lat, lon, c)))
  const weights = raw.ways.map((w) => ROAD_WEIGHT[w.highway] ?? 0.5)
  const bearing = dominantBearing(lines)
  const adj = Array.from({ length: NX * NY }, () => new Set())

  // support[a,b] = weighted metres of street that travel between nodes a and b.
  const support = new Map()
  let credit = 0
  const join = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`
    support.set(k, (support.get(k) ?? 0) + credit)
  }
  const toNode = ([x, y]) => {
    const i = Math.floor((x + (NX * CELL_M) / 2) / CELL_M)
    const j = Math.floor((y + (NY * CELL_M) / 2) / CELL_M)
    return i >= 0 && i < NX && j >= 0 && j < NY ? [i, j] : null
  }

  lines.forEach((pts, wi) => {
    const rp = pts.map((p) => rotate(p, bearing))
    let prev = null
    credit = 0
    for (let s = 1; s < rp.length; s++) {
      const [x0, y0] = rp[s - 1], [x1, y1] = rp[s]
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL_M / 4)))
      const stepLen = (Math.hypot(x1 - x0, y1 - y0) / n) * weights[wi]
      for (let t = 0; t <= n; t++) {
        const cur = toNode([x0 + ((x1 - x0) * t) / n, y0 + ((y1 - y0) * t) / n])
        if (t > 0) credit += stepLen
        if (!cur) { prev = null; credit = 0; continue }
        if (prev && (prev[0] !== cur[0] || prev[1] !== cur[1])) {
          // Walk from prev to cur in 4-neighbour steps (x first, then y).
          let [i, j] = prev
          while (i !== cur[0] || j !== cur[1]) {
            const ni = i + Math.sign(cur[0] - i)
            const nj = ni !== i ? j : j + Math.sign(cur[1] - j)
            join(key(i, j), key(ni, nj))
            i = ni; j = nj
          }
          credit = 0
        }
        prev = cur
      }
    }
  })
  // A street that crosses from one node's cell into the next is credited with
  // the distance it travelled in the first cell. Weak links are dropped.
  for (const [k, v] of support) {
    if (v < MIN_SUPPORT) continue
    const [a, b] = k.split(',').map(Number)
    adj[a].add(b); adj[b].add(a)
  }

  // Keep the largest connected component.
  const seen = new Array(NX * NY).fill(-1)
  let bestComp = -1, bestSize = 0
  for (let s = 0, comp = 0; s < NX * NY; s++) {
    if (seen[s] !== -1 || adj[s].size === 0) continue
    const stack = [s]; seen[s] = comp; let size = 0
    while (stack.length) {
      const v = stack.pop(); size++
      for (const w of adj[v]) if (seen[w] === -1) { seen[w] = comp; stack.push(w) }
    }
    if (size > bestSize) { bestSize = size; bestComp = comp }
    comp++
  }
  for (let v = 0; v < NX * NY; v++) {
    if (seen[v] !== bestComp) { for (const w of adj[v]) adj[w].delete(v); adj[v].clear() }
  }

  // Remove dead ends until none are left (they are traps in a chase game).
  let prunedDeadEnds = 0
  for (let changed = true; changed;) {
    changed = false
    for (let v = 0; v < NX * NY; v++) {
      if (adj[v].size === 1) {
        const [w] = adj[v]; adj[w].delete(v); adj[v].clear(); changed = true; prunedDeadEnds++
      }
    }
  }

  const nodes = []
  for (let v = 0; v < NX * NY; v++) if (adj[v].size > 0) nodes.push(v)
  if (nodes.length < 20) throw new Error(`${c.id}: only ${nodes.length} street nodes left`)

  // Grid: walls everywhere, then open nodes and the tiles between joined nodes.
  const grid = Array.from({ length: H }, () => new Array(W).fill('#'))
  for (const v of nodes) {
    const i = v % NX, j = Math.floor(v / NX)
    grid[2 * j + 1][2 * i + 1] = '.'
    for (const w of adj[v]) {
      const wi = w % NX, wj = Math.floor(w / NX)
      grid[j + wj + 1][i + wi + 1] = '.'
    }
  }

  // BFS distances over nodes.
  const bfs = (from) => {
    const d = new Map([[from, 0]]); const q = [from]
    for (let h = 0; h < q.length; h++) for (const w of adj[q[h]]) if (!d.has(w)) { d.set(w, d.get(q[h]) + 1); q.push(w) }
    return d
  }
  const byDist = (cx, cy) => (a, b) => {
    const da = (a % NX - cx) ** 2 + (Math.floor(a / NX) - cy) ** 2
    const db = (b % NX - cx) ** 2 + (Math.floor(b / NX) - cy) ** 2
    return da - db || a - b
  }

  // Ghost house: the junction nearest the centre; ghosts spawn on it and its corridors.
  const house = [...nodes].filter((v) => adj[v].size >= 3).sort(byDist((NX - 1) / 2, (NY - 1) / 2))[0] ?? nodes[0]
  const hi = house % NX, hj = Math.floor(house / NX)
  const ghostTiles = [[2 * hi + 1, 2 * hj + 1]]
  for (const w of [...adj[house]].sort((a, b) => a - b)) {
    ghostTiles.push([hi + (w % NX) + 1, hj + Math.floor(w / NX) + 1])
  }
  for (const [x, y] of ghostTiles.slice(0, 4)) grid[y][x] = 'G'

  // Player: at least half the maximum path distance from the ghosts, nearest bottom-centre.
  const dist = bfs(house)
  const maxD = Math.max(...dist.values())
  const player = nodes.filter((v) => dist.get(v) >= maxD / 2).sort(byDist((NX - 1) / 2, NY - 1))[0]
  grid[2 * Math.floor(player / NX) + 1][2 * (player % NX) + 1] = 'P'

  // Power cores: the free node nearest each corner.
  const used = new Set([house, player])
  for (const [cx, cy] of [[0, 0], [NX - 1, 0], [0, NY - 1], [NX - 1, NY - 1]]) {
    const v = nodes.filter((n) => !used.has(n)).sort(byDist(cx, cy))[0]
    if (v === undefined) continue
    used.add(v)
    grid[2 * Math.floor(v / NX) + 1][2 * (v % NX) + 1] = 'o'
  }

  const rows = grid.map((r) => r.join(''))
  const count = (ch) => rows.join('').split(ch).length - 1
  return {
    id: c.id,
    name: c.name,
    city: c.city,
    timezone: c.timezone,
    center: { lat: c.lat, lon: c.lon },
    bearingDeg: bearing,
    cellMeters: CELL_M,
    mazeVersion: 1,
    rows,
    stats: {
      streetNodes: nodes.length,
      corridors: nodes.reduce((n, v) => n + adj[v].size, 0) / 2,
      maxCorridors: (NX - 1) * NY + NX * (NY - 1),
      junctions: nodes.filter((v) => adj[v].size >= 3).length,
      prunedDeadEnds,
      orbs: count('.'),
      cores: count('o'),
      osmWays: raw.ways.length,
    },
    attribution: '© OpenStreetMap contributors (ODbL)',
  }
}

await mkdir(outDir, { recursive: true })
for (const c of CITIES) {
  const raw = JSON.parse(await readFile(new URL(`./raw/${c.id}.json`, import.meta.url), 'utf8'))
  const maze = buildCity(c, raw)
  await writeFile(new URL(`${c.id}.json`, outDir), JSON.stringify(maze, null, 2) + '\n')
  console.log(`\n${c.id} (bearing ${maze.bearingDeg}°) ${JSON.stringify(maze.stats)}`)
  console.log(maze.rows.join('\n'))
}
