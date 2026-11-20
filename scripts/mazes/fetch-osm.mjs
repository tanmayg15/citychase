#!/usr/bin/env node
/**
 * OFFLINE step 1: download street centrelines for each city from the public
 * Overpass API into scripts/mazes/raw/<id>.json. Run by hand only; the app
 * never calls a map service at runtime.
 *
 *   node scripts/mazes/fetch-osm.mjs [cityId ...]
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { writeFile } from 'node:fs/promises'
import { CITIES, RADIUS_M } from './cities.mjs'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const HIGHWAYS = 'primary|secondary|tertiary|residential|unclassified|living_street|pedestrian'

function bbox({ lat, lon }) {
  const r = RADIUS_M * 1.5 // extra margin so rotated crops stay covered
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(6)).join(',')
}

const wanted = process.argv.slice(2)
for (const c of CITIES.filter((c) => !wanted.length || wanted.includes(c.id))) {
  const query = `[out:json][timeout:60];way["highway"~"^(${HIGHWAYS})$"](${bbox(c)});out geom;`
  // The shared Overpass server rate-limits; back off exponentially (as it asks).
  let res
  for (let attempt = 0, wait = 5000; ; attempt++, wait *= 2) {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'citychase-maze-builder/0.1' },
      body: 'data=' + encodeURIComponent(query),
    })
    if (res.ok) break
    if (attempt >= 5 || (res.status !== 429 && res.status !== 504)) throw new Error(`${c.id}: HTTP ${res.status} ${await res.text()}`)
    console.log(`${c.id}: HTTP ${res.status}, retrying in ${wait / 1000}s`)
    await new Promise((r) => setTimeout(r, wait))
  }
  const json = await res.json()
  const ways = json.elements
    .filter((e) => e.type === 'way' && e.geometry)
    .map((e) => ({ id: e.id, highway: e.tags.highway, name: e.tags.name ?? null, geometry: e.geometry.map((p) => [p.lat, p.lon]) }))
  await writeFile(new URL(`./raw/${c.id}.json`, import.meta.url), JSON.stringify({ city: c.id, fetchedAt: new Date().toISOString(), ways }))
  console.log(`${c.id}: ${ways.length} ways`)
  await new Promise((r) => setTimeout(r, 2000)) // be polite to the shared Overpass server
}
