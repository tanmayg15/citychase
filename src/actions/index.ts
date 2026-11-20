import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getPrefs, setAlerts } from './media'
import { getOpsStatus, setIntegrationsEnabled } from './ops'
import { claimGuest, claimRun, startRun, submitRun } from './runs'
import { getWeather } from './weather'

export const actions: Record<string, ActionHandler<Env>> = {
  startRun,
  submitRun,
  claimRun,
  claimGuest,
  getWeather,
  getOpsStatus,
  setIntegrationsEnabled,
  setAlerts,
  getPrefs,
}
