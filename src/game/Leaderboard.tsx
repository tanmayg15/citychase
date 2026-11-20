import { useAuth, useQuery } from 'deepspace'

export interface LeaderRow {
  board: string
  date: string
  cityId: string
  userId: string
  name: string
  score: number
  runId: string
  guest?: boolean
}

/** Verified scores on one board (`daily:<date>` or `free:<city>:<weather>`), best first. Server-written only. */
export function useBoard(board: string) {
  return useQuery<LeaderRow>('leaderboard', { where: { board }, orderBy: 'score', orderDir: 'desc', limit: 200 })
}

/** 1-based "top N%" for a score among a board's entries. */
export function topPercent(scores: number[], score: number): number | null {
  if (scores.length === 0) return null
  const better = scores.filter((s) => s > score).length
  return Math.max(1, Math.ceil(((better + 1) / scores.length) * 100))
}

export function Leaderboard({ board, limit = 10, compact = false }: { board: string; limit?: number; compact?: boolean }) {
  const { records, status, error } = useBoard(board)
  const { userId } = useAuth()

  if (status === 'loading') return <p className="text-sm opacity-60">Loading scores…</p>
  if (status === 'error') return <p className="text-sm text-red-400">Couldn't load scores: {error}</p>
  if (records.length === 0) return <p className="text-sm opacity-60">No verified runs yet. Be the first.</p>

  return (
    <ol className="space-y-1" data-testid="leaderboard">
      {records.slice(0, limit).map((r, i) => (
        <li
          key={r.recordId}
          className={`flex justify-between rounded-md px-3 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} ${r.data.userId === userId ? 'bg-cyan-400/15 text-cyan-200' : 'bg-white/5'}`}
        >
          <span>
            <span className={`mr-3 inline-block w-5 ${i < 3 ? 'text-amber-300' : 'opacity-60'}`}>{i + 1}</span>
            {r.data.name}
            {r.data.guest && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/50">guest</span>}
          </span>
          <span className="font-mono">{r.data.score.toLocaleString('en-US')}</span>
        </li>
      ))}
    </ol>
  )
}
