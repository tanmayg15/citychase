/** In-memory stand-in for deepspace/worker ActionTools (same method shapes). Test-only. */
import type { ActionTools } from 'deepspace/worker'

export type Row = Record<string, unknown>
export type Db = Map<string, Map<string, Row>>

export interface FakeOpts {
  /** Canned integration responses by endpoint; a function can throw or count calls. */
  integration?: (endpoint: string, body: unknown) => unknown
}

export function fakeTools(db: Db, opts: FakeOpts = {}): ActionTools {
  let nextId = 0
  const coll = (c: string) => { if (!db.has(c)) db.set(c, new Map()); return db.get(c)! }
  const tools = {
    async create(c: string, data: Row, id?: string) {
      const key = id ?? `rec_${c}_${coll(c).size}_${++nextId}`
      coll(c).set(key, { ...(coll(c).get(key) ?? {}), ...structuredClone(data) })
      return { success: true, data: { recordId: key } }
    },
    async update(c: string, id: string, patch: Row) {
      const row = coll(c).get(id)
      if (!row) return { success: false, error: 'not found' }
      coll(c).set(id, { ...row, ...structuredClone(patch) })
      return { success: true, data: { recordId: id } }
    },
    async get(c: string, id: string) {
      const row = coll(c).get(id)
      return row ? { success: true, data: { record: { recordId: id, data: structuredClone(row) } } } : { success: false, error: 'not found' }
    },
    async query(c: string, o?: { where?: Row }) {
      const records = [...coll(c).entries()]
        .filter(([, r]) => Object.entries(o?.where ?? {}).every(([k, v]) => r[k] === v))
        .map(([recordId, data]) => ({ recordId, data }))
      return { success: true, data: { records, count: records.length } }
    },
    async integration(endpoint: string, body: unknown) {
      if (!opts.integration) throw new Error(`unexpected integration call ${endpoint}`)
      return { success: true, data: opts.integration(endpoint, body) }
    },
  }
  return tools as unknown as ActionTools
}
