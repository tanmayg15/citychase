/**
 * City mazes, generated offline by scripts/mazes/build-mazes.mjs from
 * OpenStreetMap data and shipped in the bundle. No map calls at runtime.
 */
import { parseMaze, type Maze } from '../engine'
import c0 from './data/nyc-midtown.json'
import c1 from './data/tokyo-shibuya.json'
import c2 from './data/paris-marais.json'
import c3 from './data/london-soho.json'
import c4 from './data/barcelona-eixample.json'
import c5 from './data/mumbai-fort.json'
import c6 from './data/sf-mission.json'
import c7 from './data/rome-centro.json'
import c8 from './data/berlin-mitte.json'
import c9 from './data/seoul-gangnam.json'
import c10 from './data/singapore-chinatown.json'
import c11 from './data/dubai-deira.json'
import c12 from './data/sydney-cbd.json'
import c13 from './data/rio-centro.json'
import c14 from './data/istanbul-beyoglu.json'
import c15 from './data/toronto-downtown.json'
import c16 from './data/amsterdam-centrum.json'
import c17 from './data/chicago-loop.json'
import c18 from './data/delhi-cp.json'
import c19 from './data/bengaluru-mg-road.json'

export interface CityMaze {
  id: string
  name: string
  city: string
  timezone: string
  center: { lat: number; lon: number }
  bearingDeg: number
  cellMeters: number
  mazeVersion: number
  rows: string[]
  stats: Record<string, number>
  attribution: string
}

/** Order = the order in scripts/mazes/cities.mjs. */
export const CITY_MAZES: CityMaze[] = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19]

export function getCity(id: string): CityMaze | undefined {
  return CITY_MAZES.find((c) => c.id === id)
}

export function cityMaze(city: CityMaze): Maze {
  return parseMaze(city.rows)
}
