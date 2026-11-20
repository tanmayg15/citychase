import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { startRun, submitRun } from './runs'

export const actions: Record<string, ActionHandler<Env>> = {
  startRun,
  submitRun,
}
