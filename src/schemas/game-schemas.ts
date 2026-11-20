/**
 * City Chase collections. Clients never write scores: runs and leaderboard
 * rows are created only by server actions (create: false for every role).
 */
import type { CollectionSchema } from 'deepspace/schema'

const SERVER_ONLY = { create: false, update: false, delete: false } as const

/**
 * One row per attempt. Created by `startRun` (status 'started'), finished by
 * `submitRun` (status 'verified' or 'rejected'). Verified runs are public so
 * Ghost Races can load them; unfinished or rejected runs are visible only to
 * their owner.
 */
export const runsSchema: CollectionSchema = {
  name: 'runs',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'date', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'mode', storage: 'text', interpretation: { kind: 'select', options: ['daily', 'endless'] }, required: true },
    { name: 'cityId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'seed', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'engineVersion', storage: 'number', interpretation: 'plain', required: true },
    { name: 'weather', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'plan', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'startedAtMs', storage: 'number', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['started', 'verified', 'rejected'] }, required: true },
    { name: 'inputLog', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'score', storage: 'number', interpretation: 'plain' },
    { name: 'durationTicks', storage: 'number', interpretation: 'plain' },
    { name: 'outcome', storage: 'text', interpretation: 'plain' },
    { name: 'rejectReason', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  visibilityField: { field: 'status', value: 'verified' },
  permissions: {
    '*': { read: 'published', ...SERVER_ONLY },
    viewer: { read: 'published', ...SERVER_ONLY },
    member: { read: 'published', ...SERVER_ONLY },
    admin: { read: true, ...SERVER_ONLY },
  },
}

/** Best verified score per user per day. Upserted by `submitRun` with id `${date}:${userId}`. */
export const leaderboardSchema: CollectionSchema = {
  name: 'leaderboard',
  columns: [
    { name: 'date', storage: 'text', interpretation: 'plain', required: true },
    { name: 'cityId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'score', storage: 'number', interpretation: 'plain', required: true },
    { name: 'runId', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['date', 'userId'],
  permissions: {
    '*': { read: true, ...SERVER_ONLY },
    viewer: { read: true, ...SERVER_ONLY },
    member: { read: true, ...SERVER_ONLY },
    admin: { read: true, ...SERVER_ONLY },
  },
}
