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
    { name: 'mode', storage: 'text', interpretation: { kind: 'select', options: ['daily', 'free', 'endless'] }, required: true },
    { name: 'board', storage: 'text', interpretation: 'plain' },
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

/**
 * Best verified score per user per board. Upserted by the run actions with id
 * `${board}:${userId}`. Boards: `daily:<date>` and `free:<cityId>:<weather>`.
 */
export const leaderboardSchema: CollectionSchema = {
  name: 'leaderboard',
  columns: [
    { name: 'board', storage: 'text', interpretation: 'plain' },
    { name: 'date', storage: 'text', interpretation: 'plain', required: true },
    { name: 'cityId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'score', storage: 'number', interpretation: 'plain', required: true },
    { name: 'runId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'guest', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  uniqueOn: ['board', 'userId'],
  permissions: {
    '*': { read: true, ...SERVER_ONLY },
    viewer: { read: true, ...SERVER_ONLY },
    member: { read: true, ...SERVER_ONLY },
    admin: { read: true, ...SERVER_ONLY },
  },
}

/** Latest weather per city (recordId = cityId), shared by all players for 30 min. */
export const weatherCacheSchema: CollectionSchema = {
  name: 'weatherCache',
  columns: [
    { name: 'cityId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'weather', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'fetchedAtMs', storage: 'number', interpretation: 'plain', required: true },
    { name: 'source', storage: 'text', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': { read: true, ...SERVER_ONLY },
    viewer: { read: true, ...SERVER_ONLY },
    member: { read: true, ...SERVER_ONLY },
    admin: { read: true, ...SERVER_ONLY },
  },
}

/**
 * Real integration calls counted per day. recordId = `${date}:${kind}:${scope}`
 * where scope is 'global' or a userId. Owner (admin) reads all; users read their own.
 */
export const usageSchema: CollectionSchema = {
  name: 'usage',
  columns: [
    { name: 'date', storage: 'text', interpretation: 'plain', required: true },
    { name: 'kind', storage: 'text', interpretation: 'plain', required: true },
    { name: 'scope', storage: 'text', interpretation: 'plain', required: true },
    { name: 'count', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'scope',
  permissions: {
    '*': { read: false, ...SERVER_ONLY },
    viewer: { read: false, ...SERVER_ONLY },
    member: { read: 'own', ...SERVER_ONLY },
    admin: { read: true, ...SERVER_ONLY },
  },
}
