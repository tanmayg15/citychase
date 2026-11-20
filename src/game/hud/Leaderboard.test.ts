import { describe, expect, it } from 'vitest'
import { boardLabel } from './Leaderboard'

describe('boardLabel', () => {
  it('names the board a score came from', () => {
    expect(boardLabel('free:nyc-midtown:clear')).toBe('New York · Clear')
    expect(boardLabel('daily:2026-11-20', 'singapore-chinatown')).toBe('Daily heist · Singapore')
    expect(boardLabel(undefined)).toBeNull()
  })
})
