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

/** Maze cells. Orb tiles from the maze files are plain street; Core tiles are smoke-bomb spots. */
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

/** A parsed maze. `cells` is row-major, length width*height. Walls are buildings. */
export interface Maze {
  width: number
  height: number
  cells: number[]
  playerSpawn: Point
  /** Police garage tiles. */
  ghostSpawns: Point[]
}

/** How a cop patrols while it has not spotted you. */
export type CopMode = 'guardLoot' | 'guardExit' | 'patrol' | 'roam'

export interface CommanderPlan {
  version: 1
  personality: 'strategist' | 'swarm' | 'default'
  /** Exactly one mode per cop (4 cops). */
  cops: CopMode[]
  /** Open tiles the commander wants patrolled. 0..6 entries. */
  chokepoints: Point[]
  taunt: string
}

export interface WeatherModifiers {
  /** Extra tiles the car slides in the old direction after a turn request. */
  slipTiles: number
  /** Patrolling cops take an extra step in `dir` every `every` moves. */
  wind: { dir: Dir; every: number } | null
  /** Render-only: visible radius in tiles around the player. null = full view. */
  visionRadius: number | null
  /** How far down a street a cop can spot you, in tiles. */
  copVision: number
  /** How long a smoke bomb blinds cops, in ticks. */
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

export type CopStatus = 'garage' | 'patrol' | 'chase' | 'search' | 'blind'

export interface CopState {
  x: number
  y: number
  dir: Dir
  mode: CopMode
  status: CopStatus
  releaseTick: number
  homeX: number
  homeY: number
  /** Current patrol/search destination. */
  tx: number
  ty: number
  patrolIdx: number
  /** search: give up at this tick. blind: recover at this tick. */
  until: number
  clock: number
  windClock: number
}

export interface Loot {
  x: number
  y: number
  value: number
  taken: boolean
}

export interface Pickup {
  x: number
  y: number
  taken: boolean
}

export type GameStatus = 'playing' | 'escaped' | 'busted' | 'timeout'

export type GameEvent =
  | { type: 'loot'; value: number }
  | { type: 'exitOpen' }
  | { type: 'smoke'; blinded: number }
  | { type: 'spotted'; cop: number }
  | { type: 'caught'; livesLeft: number }
  | { type: 'end'; status: GameStatus }

export interface GameState {
  tick: number
  rng: number
  status: GameStatus
  /** Final or running score (see engine.scoreOf). */
  score: number
  lootScore: number
  lootTaken: number
  lives: number
  loot: Loot[]
  smokes: Pickup[]
  exit: { x: number; y: number; open: boolean }
  /** Ticks during which at least one cop could see you. */
  heat: number
  lastSeen: Point | null
  player: PlayerState
  cops: CopState[]
  pauseUntil: number
  /** Events from the most recent step only. Not part of the state hash. */
  events: GameEvent[]
}
