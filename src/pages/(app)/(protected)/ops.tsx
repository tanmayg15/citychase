/**
 * Owner console: integration mode, kill switch, and today's real-call usage
 * against the caps. Everything here goes through owner-only server actions.
 */
import { useCallback, useEffect, useState } from 'react'
import { callAction } from '@/game/api'

interface OpsStatus {
  date: string
  mode: 'live' | 'mock'
  integrationsEnabled: boolean
  caps: Record<string, { global: number; perUser: number | null }>
  globalToday: Record<string, number>
  perUserToday: Array<{ kind: string; scope: string; count: number }>
}

export default function OpsPage() {
  const [status, setStatus] = useState<OpsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    callAction<OpsStatus>('getOpsStatus').then(setStatus, (e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const toggle = async () => {
    if (!status) return
    setBusy(true)
    try {
      await callAction('setIntegrationsEnabled', { enabled: !status.integrationsEnabled })
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="p-8 text-red-400" data-testid="ops-error">{error}</div>
  if (!status) return <div className="p-8 opacity-60">Loading…</div>

  const realCalls = status.mode === 'live' && status.integrationsEnabled
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6" data-testid="ops">
      <h1 className="text-2xl font-bold">Owner console</h1>
      <section className="rounded-lg border border-border p-4">
        <p>Mode (env <code>INTEGRATIONS_MODE</code>): <strong data-testid="ops-mode">{status.mode}</strong></p>
        <p className="mt-1">
          Kill switch: <strong data-testid="ops-enabled">{status.integrationsEnabled ? 'integrations ON' : 'integrations OFF'}</strong>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Real paid calls happen only when mode is <code>live</code> AND the switch is ON. Right now:{' '}
          <strong>{realCalls ? 'real calls allowed (within caps)' : 'no real calls (fallbacks used)'}</strong>.
        </p>
        <button
          onClick={toggle}
          disabled={busy}
          data-testid="ops-toggle"
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status.integrationsEnabled ? 'Turn integrations OFF' : 'Turn integrations ON'}
        </button>
      </section>
      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-2 font-semibold">Real calls today ({status.date} UTC)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th>Kind</th><th>Global</th><th>Global cap</th><th>Per-user cap</th></tr></thead>
          <tbody>
            {Object.entries(status.caps).map(([k, c]) => (
              <tr key={k}><td>{k}</td><td data-testid={`usage-${k}`}>{status.globalToday[k] ?? 0}</td><td>{c.global}</td><td>{c.perUser ?? '–'}</td></tr>
            ))}
          </tbody>
        </table>
        {status.perUserToday.length > 0 && (
          <details className="mt-3 text-sm">
            <summary>Per-user counts</summary>
            <ul>{status.perUserToday.map((r) => <li key={r.kind + r.scope}>{r.kind} · {r.scope}: {r.count}</li>)}</ul>
          </details>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Account-wide spend: <code>npx deepspace app usage</code></p>
      </section>
    </div>
  )
}
