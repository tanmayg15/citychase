import { describe, expect, it } from 'vitest'
import { CLEAR_WEATHER, DEFAULT_PLAN, MAX_TICKS, createGame, parseMaze, weatherToModifiers, type GameState } from '../engine'
import { TEST_MAZE_ROWS } from '../engine/fixtures'
import { RADIO_LINES } from '../shared/radio-lines'
import { RadioDirector } from './radio-director'

const cfg = { maze: parseMaze(TEST_MAZE_ROWS), seed: 1, modifiers: weatherToModifiers(CLEAR_WEATHER), plan: DEFAULT_PLAN }
const fresh = (): GameState => createGame(cfg)

describe('RadioDirector', () => {
  it('rotates through the spotted lines, at most one every 8 s', () => {
    const d = new RadioDirector()
    const s = fresh()
    s.events = [{ type: 'spotted', cop: 0 }]
    expect(d.cues(s, 0, MAX_TICKS)).toEqual(['spotted'])
    expect(d.cues(s, 1000, MAX_TICKS)).toEqual([])
    expect(d.cues(s, 9000, MAX_TICKS)).toEqual(['spotted2'])
    expect(d.cues(s, 18000, MAX_TICKS)).toEqual(['spotted3'])
  })

  it('caught → caught / lastlife, then respawn once the pause ends; final catch → busted', () => {
    const d = new RadioDirector()
    const s = fresh()
    s.events = [{ type: 'caught', livesLeft: 2 }]
    s.tick = 100; s.pauseUntil = 140
    expect(d.cues(s, 0, MAX_TICKS)).toEqual(['caught'])
    s.events = []; s.tick = 120
    expect(d.cues(s, 1000, MAX_TICKS)).toEqual([])
    s.tick = 140
    expect(d.cues(s, 2000, MAX_TICKS)).toEqual(['respawn'])
    s.events = [{ type: 'caught', livesLeft: 1 }]
    expect(d.cues(s, 3000, MAX_TICKS)[0]).toBe('lastlife')
    s.events = [{ type: 'caught', livesLeft: 0 }]
    expect(d.cues(s, 4000, MAX_TICKS)[0]).toBe('busted')
  })

  it('gadgets get their own lines', () => {
    const d = new RadioDirector()
    const s = fresh()
    s.events = [{ type: 'gadget', kind: 'nitro' }, { type: 'spinout', cop: 1 }]
    expect(d.cues(s, 0, MAX_TICKS)).toEqual(['nitro', 'spinout'])
    s.events = [{ type: 'gadget', kind: 'oil' }]
    expect(d.cues(s, 0, MAX_TICKS)).toEqual([])
  })

  it('says "lost" when the last chasing cop loses you', () => {
    const d = new RadioDirector()
    const s = fresh()
    s.cops[0].status = 'chase'
    d.cues(s, 0, MAX_TICKS)
    s.cops[0].status = 'search'
    expect(d.cues(s, 500, MAX_TICKS)).toEqual(['lost'])
  })

  it('warns once at 30 seconds left', () => {
    const d = new RadioDirector()
    const s = fresh()
    s.tick = MAX_TICKS - 30 * 20
    expect(d.cues(s, 0, MAX_TICKS)).toEqual(['lowtime'])
    expect(d.cues(s, 0, MAX_TICKS)).toEqual([])
  })

  it('every line it can pick has subtitle text', () => {
    for (const id of ['spotted', 'spotted2', 'spotted3', 'caught', 'lastlife', 'respawn', 'busted', 'nitro', 'spinout', 'disguise', 'lost', 'lowtime', 'escaped', 'smoke', 'safehouse'] as const) {
      expect(RADIO_LINES[id].length).toBeGreaterThan(5)
    }
  })
})
