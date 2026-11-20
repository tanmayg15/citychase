import { isOpen } from './maze'
import type { CommanderPlan, GhostMode, Maze, Point } from './types'

export const GHOST_COUNT = 4
export const MAX_CHOKEPOINTS = 6
export const MAX_TAUNT = 120
const MODES: GhostMode[] = ['chase', 'ambush', 'patrol', 'cutoff']

/** Used whenever the AI is off, capped, failed, or returned something invalid. */
export const DEFAULT_PLAN: CommanderPlan = {
  version: 1,
  personality: 'default',
  ghosts: ['chase', 'ambush', 'patrol', 'cutoff'],
  chokepoints: [],
  taunt: 'The city never sleeps. Neither do we.',
}

export type PlanCheck = { ok: true; plan: CommanderPlan } | { ok: false; errors: string[] }

/**
 * Strict check of an untrusted plan (from an LLM or a client) against a maze.
 * Returns a fresh, clean copy; unknown fields are dropped.
 */
export function validatePlan(input: unknown, maze: Maze): PlanCheck {
  const errors: string[] = []
  const o = input as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'] }

  const personality = o.personality
  if (personality !== 'strategist' && personality !== 'swarm' && personality !== 'default') {
    errors.push('personality must be strategist | swarm | default')
  }

  const ghosts = o.ghosts
  if (!Array.isArray(ghosts) || ghosts.length !== GHOST_COUNT ||
      !ghosts.every((g) => MODES.includes(g as GhostMode))) {
    errors.push(`ghosts must be ${GHOST_COUNT} of ${MODES.join('|')}`)
  }

  const chokepoints: Point[] = []
  if (!Array.isArray(o.chokepoints) || o.chokepoints.length > MAX_CHOKEPOINTS) {
    errors.push(`chokepoints must be an array of at most ${MAX_CHOKEPOINTS}`)
  } else {
    for (const c of o.chokepoints as unknown[]) {
      const p = c as Record<string, unknown> | null
      const x = p?.x, y = p?.y
      if (!Number.isInteger(x) || !Number.isInteger(y) ||
          (x as number) < 0 || (y as number) < 0 ||
          (x as number) >= maze.width || (y as number) >= maze.height ||
          !isOpen(maze, x as number, y as number)) {
        errors.push(`chokepoint ${JSON.stringify(c)} is not an open tile`)
      } else {
        chokepoints.push({ x: x as number, y: y as number })
      }
    }
  }

  const taunt = o.taunt
  if (typeof taunt !== 'string' || taunt.trim().length === 0 || taunt.length > MAX_TAUNT) {
    errors.push(`taunt must be 1..${MAX_TAUNT} chars`)
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    plan: {
      version: 1,
      personality: personality as CommanderPlan['personality'],
      ghosts: [...(ghosts as GhostMode[])],
      chokepoints,
      taunt: (taunt as string).trim(),
    },
  }
}

/** Validated plan, or the default plan if invalid. The game never breaks because of the AI. */
export function planOrDefault(input: unknown, maze: Maze): CommanderPlan {
  const r = validatePlan(input, maze)
  return r.ok ? r.plan : DEFAULT_PLAN
}
