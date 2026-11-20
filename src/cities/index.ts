/**
 * City mazes, generated offline by scripts/mazes/build-mazes.mjs from
 * OpenStreetMap data and shipped in the bundle. No map calls at runtime.
 */
import { parseMaze, type Maze } from '../engine'
import barcelona from './data/barcelona-eixample.json'
import london from './data/london-soho.json'
import mumbai from './data/mumbai-fort.json'
import nyc from './data/nyc-midtown.json'
import paris from './data/paris-marais.json'
import sf from './data/sf-mission.json'
import tokyo from './data/tokyo-shibuya.json'

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

export const CITY_MAZES: CityMaze[] = [nyc, tokyo, paris, london, barcelona, mumbai, sf]

export function getCity(id: string): CityMaze | undefined {
  return CITY_MAZES.find((c) => c.id === id)
}

export function cityMaze(city: CityMaze): Maze {
  return parseMaze(city.rows)
}
