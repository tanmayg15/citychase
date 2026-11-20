/**
 * Shared engine types. The engine runs identically in the browser and in the
 * worker (server-side replay), so everything here is plain JSON data.
 */

/** 0 = no input / stopped. Grid y grows downward (south). */
export enum Dir {
  None = 0,
  Up = 1,
  Right = 2,
  Down = 3,
  Left = 4,
}

export enum Cell {
  Empty = 0,
  Wall = 1,
  Orb = 2,
  Core = 3,
}

export interface Point {
  x: number
  y: number
}

/** A parsed maze. `cells` is row-major, length width*height. */
export interface Maze {
  width: number
  height: number
  cells: number[]
  playerSpawn: Point
  ghostSpawns: Point[]
}

export type GhostMode = 'chase' | 'ambush' | 'patrol' | 'cutoff'

export interface CommanderPlan {
  version: 1
  personality: 'strategist' | 'swarm' | 'default'
  /** Exactly one mode per ghost (4 ghosts). */
  ghosts: GhostMode[]
  /** Open tiles the commander wants guarded. 0..6 entries. */
  chokepoints: Point[]
  taunt: string
}

export interface WeatherModifiers {
  /** Extra tiles of momentum in the old direction after a turn request. */
  slipTiles: number
  /** Ghosts take an extra step in `dir` every `every` ghost moves. */
  wind: { dir: Dir; every: number } | null
  /** Render-only: visible radius in tiles around the player. null = full view. */
  visionRadius: number | null
  /** How long power cores last, in ticks. */
  powerTicks: number
}

export interface GameConfig {
  maze: Maze
  /** uint32 seed; the only source of randomness. */
  seed: number
  modifiers: WeatherModifiers
  plan: CommanderPlan
}

/** Sparse input log: [tick, dir] entries, strictly increasing ticks. */
export type InputLog = Array<[number, Dir]>

export interface PlayerState {
  x: number
  y: number
  dir: Dir
  wanted: Dir
  slip: number
  clock: number
}

export type GhostStatus = 'house' | 'active' | 'frightened' | 'eaten'

export interface GhostState {
  x: number
  y: number
  dir: Dir
  mode: GhostMode
  status: GhostStatus
  releaseTick: number
  homeX: number
  homeY: number
  patrolIdx: number
  clock: number
  windClock: number
}

export type GameStatus = 'playing' | 'won' | 'lost' | 'timeout'

export type GameEvent =
  | { type: 'orb' }
  | { type: 'core' }
  | { type: 'ghostEaten'; ghost: number; points: number }
  | { type: 'death'; livesLeft: number }
  | { type: 'end'; status: GameStatus }

export interface GameState {
  tick: number
  rng: number
  status: GameStatus
  score: number
  lives: number
  pelletsLeft: number
  cells: number[]
  player: PlayerState
  ghosts: GhostState[]
  powerUntil: number
  combo: number
  pauseUntil: number
  /** Events from the most recent step only. Not part of the state hash. */
  events: GameEvent[]
}
