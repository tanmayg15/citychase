/**
 * City Chase look for the non-game pages (settings, ops, about, 404): the
 * lobby's night-city gradient, glass panels and orange/cyan neon accents.
 */
import type { ReactNode } from 'react'

export const BACKDROP = 'radial-gradient(ellipse at 20% 0%, #2a1650 0%, transparent 55%), radial-gradient(ellipse at 90% 100%, #0c3a4a 0%, transparent 50%), #07030f'

/** Full-height branded page with a centred column. */
export function PageShell({ title, kicker, children, width = 'max-w-3xl', testId }: {
  title: string
  kicker?: string
  children: ReactNode
  width?: string
  testId?: string
}) {
  return (
    <div className="min-h-full text-[#ece6ff]" style={{ background: BACKDROP }} data-testid={testId}>
      <div className={`mx-auto ${width} px-4 py-10 sm:px-6 sm:py-14`}>
        {kicker && <p className="text-[11px] uppercase tracking-[0.3em] text-orange-300">{kicker}</p>}
        <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl" style={{ textShadow: '0 0 24px rgba(255,138,31,0.45)' }}>{title}</h1>
        <div className="mt-8 space-y-5">{children}</div>
      </div>
    </div>
  )
}

/** A glass card with an optional heading row. */
export function Panel({ title, hint, action, children, accent = 'border-white/10', testId }: {
  title?: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  accent?: string
  testId?: string
}) {
  return (
    <section className={`rounded-2xl border ${accent} bg-black/45 p-5 shadow-xl backdrop-blur-md sm:p-6`} data-testid={testId}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {hint && <p className="mt-0.5 text-sm text-white/55">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Accessible on/off switch in the brand colours. */
export function Toggle({ on, onChange, label, disabled, testId }: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${on ? 'border-cyan-300 bg-cyan-400/40 shadow-[0_0_14px_rgba(55,245,255,0.45)]' : 'border-white/20 bg-white/10'}`}
    >
      <span className={`absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${on ? 'left-[calc(100%-1.5rem)]' : 'left-0.5'}`} />
    </button>
  )
}

/** One labelled row in a settings list: text on the left, a control on the right. */
export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-white/5 py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        {hint && <p className="text-sm text-white/55">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** Segmented choice (e.g. 3D / 2D). */
export function Segmented<T extends string>({ value, options, onChange, testId }: {
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
  testId?: string
}) {
  return (
    <div className="flex shrink-0 rounded-full bg-white/5 p-0.5 text-sm ring-1 ring-white/10" role="radiogroup" data-testid={testId}>
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`whitespace-nowrap rounded-full px-3 py-1 transition ${value === v ? 'bg-cyan-400/30 text-white' : 'text-white/60 hover:text-white'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export const primaryBtn = 'rounded-xl bg-orange-500 px-5 py-2.5 font-bold text-black shadow-[0_0_24px_rgba(255,138,31,0.5)] transition hover:bg-orange-400 disabled:opacity-50'
export const secondaryBtn = 'rounded-xl border border-white/20 bg-white/5 px-5 py-2.5 font-semibold text-white transition hover:bg-white/10 disabled:opacity-50'
