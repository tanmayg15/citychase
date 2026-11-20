/**
 * Your account: profile, best scores, game preferences (this browser) and
 * the #1 email alert. Sign-in is enforced by (protected)/_layout.tsx.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { signOut, useQuery, useUser } from 'deepspace'
import { PageShell, Panel, Row, Segmented, Toggle, primaryBtn, secondaryBtn } from '@/components/brand'
import { callAction } from '@/game/api'
import { boardLabel, type LeaderRow } from '@/game/hud/Leaderboard'
import { getSfx, loadMuted, saveMuted } from '@/game/sound'
import { useView } from '@/game/useView'

const GHOST_KEY = 'citychase:ghost'

function readGhost(): boolean {
  try { return localStorage.getItem(GHOST_KEY) === '1' } catch { return false }
}

export default function SettingsPage() {
  const { user } = useUser()
  const [view, setView] = useView()
  const [muted, setMuted] = useState(false)
  const [ghost, setGhost] = useState(false)
  const [alerts, setAlerts] = useState<boolean | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)

  useEffect(() => { setMuted(loadMuted()); setGhost(readGhost()) }, [])
  useEffect(() => {
    callAction<{ emailAlerts: boolean }>('getPrefs').then((p) => setAlerts(p.emailAlerts)).catch(() => setAlerts(false))
  }, [])

  const { records } = useQuery<LeaderRow>('scores', { where: { userId: user?.id ?? '__none__' }, orderBy: 'score', orderDir: 'desc', limit: 50 })
  const best = records.find((r) => r.data.board === 'alltime')?.data
  const boards = records.filter((r) => r.data.board !== 'alltime').map((r) => r.data)

  const toggleSound = (on: boolean) => { setMuted(!on); saveMuted(!on); getSfx()?.setMuted(!on) }
  const toggleGhost = (on: boolean) => { setGhost(on); try { localStorage.setItem(GHOST_KEY, on ? '1' : '0') } catch { /* storage blocked */ } }
  const toggleAlerts = (on: boolean) => {
    setAlerts(on); setAlertError(null)
    callAction('setAlerts', { enabled: on }).catch((e: Error) => { setAlerts(!on); setAlertError(e.message) })
  }

  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <PageShell kicker="Your garage" title="Settings" testId="settings">
      <Panel accent="border-orange-400/30">
        <div className="flex flex-wrap items-center gap-4">
          {user?.imageUrl
            ? <img src={user.imageUrl} referrerPolicy="no-referrer" alt="" className="h-16 w-16 rounded-full ring-2 ring-orange-400/60" />
            : <div className="grid h-16 w-16 place-items-center rounded-full bg-orange-500/30 text-2xl font-black ring-2 ring-orange-400/60">{initial}</div>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold" data-testid="settings-name">{user?.name ?? 'Driver'}</p>
            <p className="truncate text-sm text-white/60" data-testid="settings-email">{user?.email ?? '—'}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-black tabular-nums" style={{ textShadow: '0 0 16px rgba(255,138,31,0.5)' }} data-testid="settings-best">
              {best ? best.score.toLocaleString('en-US') : '—'}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-white/50">All-time best{best?.fromBoard ? ` · ${boardLabel(best.fromBoard, best.cityId)}` : ''}</p>
          </div>
        </div>
      </Panel>

      <Panel title="Your best runs" hint="Your top score on each board you have played. Every one was verified by server replay.">
        {boards.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm text-white/70">
            No verified runs yet.
            <Link to="/" className={primaryBtn}>▶ Play a heist</Link>
          </div>
        ) : (
          <ul className="space-y-1.5" data-testid="settings-boards">
            {boards.map((b) => (
              <li key={b.board} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span className="truncate">{boardLabel(b.board, b.cityId) ?? b.board}</span>
                <span className="font-mono tabular-nums">{b.score.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Game" hint="Saved in this browser.">
        <Row label="View" hint="3D chase cam, or the flat map for older devices.">
          <Segmented value={view} onChange={setView} options={[['3d', '3D'], ['2d', '2D']]} testId="settings-view" />
        </Row>
        <Row label="Sound" hint="Engine, sirens and the police radio.">
          <Toggle on={!muted} onChange={toggleSound} label="Sound" testId="settings-sound" />
        </Row>
        <Row label="Race the #1 ghost" hint="Start every run against the board leader's replay.">
          <Toggle on={ghost} onChange={toggleGhost} label="Race the #1 ghost" testId="settings-ghost" />
        </Row>
      </Panel>

      <Panel title="Notifications">
        <Row label="#1 alerts" hint={alertError ?? 'Email me when someone takes my #1 spot on a board.'}>
          <Toggle on={!!alerts} onChange={toggleAlerts} disabled={alerts === null} label="#1 email alerts" testId="settings-alerts" />
        </Row>
      </Panel>

      <div className="flex flex-wrap gap-3">
        <Link to="/" className={primaryBtn}>← Back to the lobby</Link>
        <button onClick={() => void signOut()} className={secondaryBtn} data-testid="settings-sign-out">Sign out</button>
      </div>
    </PageShell>
  )
}
