/**
 * Owner console: integration mode, kill switch, today's real-call usage
 * against the caps, and today's runs. Everything goes through owner-only
 * server actions (the page itself shows "Forbidden" to anyone else).
 */
import { useCallback, useEffect, useState } from 'react'
import { PageShell, Panel, Toggle, secondaryBtn } from '@/components/brand'
import { callAction } from '@/game/api'

interface OpsStatus {
  date: string
  mode: 'live' | 'mock'
  integrationsEnabled: boolean
  caps: Record<string, { global: number; perUser: number | null }>
  globalToday: Record<string, number>
  perUserToday: Array<{ kind: string; scope: string; count: number }>
  runsToday: { verified: number; rejected: number; started: number }
}

const KIND: Record<string, { icon: string; label: string; what: string }> = {
  weather: { icon: '🌦️', label: 'Weather', what: 'OpenWeatherMap, per city, cached 30 min' },
  email: { icon: '✉️', label: 'Email', what: '#1 knocked-off alerts (opt-in)' },
  news: { icon: '📰', label: 'News', what: "NewsAPI headlines for today's city" },
  tts: { icon: '📻', label: 'Radio voices', what: 'ElevenLabs police lines, cached forever' },
}

function Stat({ label, value, tone = 'text-white', testId }: { label: string; value: React.ReactNode; tone?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className={`font-mono text-2xl font-black tabular-nums ${tone}`} data-testid={testId}>{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-white/50">{label}</p>
    </div>
  )
}

export default function OpsPage() {
  const [status, setStatus] = useState<OpsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    callAction<OpsStatus>('getOpsStatus').then(setStatus, (e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      await callAction('setIntegrationsEnabled', { enabled })
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <PageShell kicker="Owner only" title="Ops console">
        <Panel accent="border-red-400/40"><p className="text-red-300" data-testid="ops-error">{error}</p></Panel>
      </PageShell>
    )
  }
  if (!status) {
    return <PageShell kicker="Owner only" title="Ops console"><Panel><p className="text-white/60">Loading…</p></Panel></PageShell>
  }

  const realCalls = status.mode === 'live' && status.integrationsEnabled
  return (
    <PageShell kicker="Owner only" title="Ops console" width="max-w-4xl" testId="ops">
      <Panel
        accent={realCalls ? 'border-emerald-400/40' : 'border-amber-400/40'}
        title="Paid integrations"
        hint={<>Real calls happen only when the mode is <code className="text-white/80">live</code> <em>and</em> the switch is on. Otherwise every feature uses its free fallback.</>}
        action={<button onClick={load} className={`${secondaryBtn} px-3 py-1.5 text-sm`} data-testid="ops-refresh">↻ Refresh</button>}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${realCalls ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-amber-400 shadow-[0_0_10px_#fbbf24]'}`} />
            <div>
              <p className="font-bold" data-testid="ops-enabled">{status.integrationsEnabled ? 'Integrations ON' : 'Integrations OFF'}</p>
              <p className="text-sm text-white/60">
                Mode <code data-testid="ops-mode">{status.mode}</code> · {realCalls ? 'real calls allowed, within the caps below' : 'no real calls: fallbacks in use'}
              </p>
            </div>
          </div>
          <Toggle on={status.integrationsEnabled} onChange={toggle} disabled={busy} label="Integrations kill switch" testId="ops-toggle" />
        </div>
      </Panel>

      <Panel title="Runs today" hint={`${status.date} (UTC)`}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Verified" value={status.runsToday.verified} tone="text-emerald-300" testId="ops-runs-verified" />
          <Stat label="Rejected" value={status.runsToday.rejected} tone="text-red-300" />
          <Stat label="Started" value={status.runsToday.started} tone="text-white/80" />
        </div>
      </Panel>

      <Panel title="Real calls today" hint="Counted before each paid call; a call over its cap uses the fallback instead.">
        <div className="space-y-3">
          {Object.entries(status.caps).map(([k, c]) => {
            const used = status.globalToday[k] ?? 0
            const pct = Math.min(100, Math.round((used / Math.max(1, c.global)) * 100))
            const meta = KIND[k] ?? { icon: '•', label: k, what: '' }
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span><span className="mr-1.5">{meta.icon}</span><strong>{meta.label}</strong> <span className="hidden text-white/50 sm:inline">· {meta.what}</span></span>
                  <span className="font-mono tabular-nums"><span data-testid={`usage-${k}`}>{used}</span> / {c.global}{c.perUser ? <span className="text-white/45"> · {c.perUser}/user</span> : null}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
        {status.perUserToday.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-white/70">Per-user counts ({status.perUserToday.length})</summary>
            <ul className="mt-2 space-y-1">
              {status.perUserToday.map((r) => (
                <li key={r.kind + r.scope} className="flex justify-between rounded bg-white/5 px-3 py-1.5 font-mono text-xs">
                  <span>{r.kind} · {r.scope}</span><span>{r.count}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-4 text-xs text-white/45">Account-wide spend: <code>npx deepspace app usage</code></p>
      </Panel>
    </PageShell>
  )
}
