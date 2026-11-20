import { useEffect, useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { loadGuest } from './api'

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

/** Board ids: 'alltime' (one row per player), `daily:<date>`, `free:<city>:<weather>`. Server-written only. */
export function useBoard(board: string) {
  return useQuery<LeaderRow>('leaderboard', { where: { board }, orderBy: 'score', orderDir: 'desc', limit: 500 })
}

/** 1-based "top N%" for a score among a board's entries. */
export function topPercent(scores: number[], score: number): number | null {
  if (scores.length === 0) return null
  const better = scores.filter((s) => s > score).length
  return Math.max(1, Math.ceil(((better + 1) / scores.length) * 100))
}

/** The current player's leaderboard userId: the account, or this browser's guest identity. */
export function useMyLeaderId(): string | null {
  const { userId, isSignedIn } = useAuth()
  const [guestId, setGuestId] = useState<string | null>(null)
  useEffect(() => setGuestId(loadGuest()?.guestId ?? null), [])
  if (isSignedIn && userId) return userId
  return guestId ? `guest_${guestId}` : null
}

const MEDAL = ['🥇', '🥈', '🥉']

function Row({ rank, row, me }: { rank: number; row: LeaderRow; me: boolean }) {
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm ${me ? 'bg-orange-400/20 text-orange-100 ring-1 ring-orange-300/50' : 'bg-white/5'}`}
      data-testid={me ? 'leader-me' : undefined}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`w-6 shrink-0 text-center ${rank <= 3 ? '' : 'text-white/50'}`}>{rank <= 3 ? MEDAL[rank - 1] : rank}</span>
        <span className="truncate">{row.name}{me ? ' (you)' : ''}</span>
        {row.guest && <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/50">guest</span>}
      </span>
      <span className="font-mono tabular-nums">{row.score.toLocaleString('en-US')}</span>
    </li>
  )
}

/** Top `limit` players, plus your own row and rank underneath when you are further down. */
export function Leaderboard({ board, limit = 10 }: { board: string; limit?: number }) {
  const { records, status, error } = useBoard(board)
  const me = useMyLeaderId()

  if (status === 'loading') return <p className="text-sm opacity-60">Loading scores…</p>
  if (status === 'error') return <p className="text-sm text-red-400">Couldn't load scores: {error}</p>
  if (records.length === 0) return <p className="text-sm opacity-60">No verified runs yet. Be the first.</p>

  const myIndex = me ? records.findIndex((r) => r.data.userId === me) : -1
  return (
    <div data-testid="leaderboard">
      <ol className="space-y-1">
        {records.slice(0, limit).map((r, i) => <Row key={r.recordId} rank={i + 1} row={r.data} me={r.data.userId === me} />)}
      </ol>
      {myIndex >= limit && (
        <>
          <p className="my-1 text-center text-xs text-white/30">⋯</p>
          <ol><Row rank={myIndex + 1} row={records[myIndex].data} me /></ol>
        </>
      )}
      <p className="mt-2 text-right text-[11px] text-white/35">{records.length} {records.length === 1 ? 'player' : 'players'}</p>
    </div>
  )
}
