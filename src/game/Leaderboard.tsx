import { useAuth, useQuery } from 'deepspace'

export interface LeaderRow {
  date: string
  cityId: string
  userId: string
  name: string
  score: number
  runId: string
}

/** Today's verified scores, best first. Rows are written only by the submitRun action. */
export function useDailyBoard(date: string) {
  return useQuery<LeaderRow>('leaderboard', { where: { date }, orderBy: 'score', orderDir: 'desc', limit: 200 })
}

/** 1-based "top N%" for a score among today's entries. */
export function topPercent(scores: number[], score: number): number | null {
  if (scores.length === 0) return null
  const better = scores.filter((s) => s > score).length
  return Math.max(1, Math.ceil(((better + 1) / scores.length) * 100))
}

export function Leaderboard({ date, limit = 10 }: { date: string; limit?: number }) {
  const { records, status, error } = useDailyBoard(date)
  const { userId } = useAuth()

  if (status === 'loading') return <p className="text-sm opacity-60">Loading scores…</p>
  if (status === 'error') return <p className="text-sm text-red-400">Couldn't load scores: {error}</p>
  if (records.length === 0) return <p className="text-sm opacity-60">No verified runs yet today. Be the first.</p>

  return (
    <ol className="space-y-1" data-testid="leaderboard">
      {records.slice(0, limit).map((r, i) => (
        <li
          key={r.recordId}
          className={`flex justify-between rounded-md px-3 py-1.5 text-sm ${r.data.userId === userId ? 'bg-cyan-400/15 text-cyan-200' : 'bg-white/5'}`}
        >
          <span><span className="mr-3 inline-block w-5 opacity-60">{i + 1}</span>{r.data.name}</span>
          <span className="font-mono">{r.data.score.toLocaleString('en-US')}</span>
        </li>
      ))}
    </ol>
  )
}
