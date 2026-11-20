/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import {
  leaderboardSchema, newsCacheSchema, prefsSchema, radioCacheSchema, runsSchema, usageSchema, weatherCacheSchema,
} from './schemas/game-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  runsSchema,
  leaderboardSchema,
  weatherCacheSchema,
  usageSchema,
  newsCacheSchema,
  radioCacheSchema,
  prefsSchema,
]
