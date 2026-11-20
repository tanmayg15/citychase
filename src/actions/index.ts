import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getOpsStatus, setIntegrationsEnabled } from './ops'
import { startRun, submitRun } from './runs'
import { getWeather } from './weather'

export const actions: Record<string, ActionHandler<Env>> = {
  startRun,
  submitRun,
  getWeather,
  getOpsStatus,
  setIntegrationsEnabled,
}
