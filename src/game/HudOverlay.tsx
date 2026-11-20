/**
 * In-game HUD, drawn over the full-screen game. Three glass panels:
 *  left   where you are: city, district, weather and the rules it brings
 *  centre how you're doing: score, loot collected, safehouse status
 *  right  time left and lives
 * plus a flashing WANTED banner while a cop is chasing you.
 */
import type { CityMaze } from '../cities'
import { ruleBadges, weatherEmoji } from './daily'
import type { Hud } from './GameCanvas'
import type { WeatherRecord } from './weather-source'

const glass = 'rounded-2xl border border-white/15 bg-black/55 shadow-lg backdrop-blur-md'

export function HudOverlay({ hud, city, weather, mode, ghostName }: {
  hud: Hud | null
  /** Set when racing a ghost: whose run it is. */
  ghostName?: string
  city: CityMaze
  weather: WeatherRecord
  mode: 'daily' | 'free'
}) {
  const need = hud ? Math.max(0, hud.lootToOpen - hud.lootTaken) : 0
  const secs = hud?.secondsLeft ?? 180
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const low = secs <= 30

  return (
    <>
    {hud && hud.respawnIn > 0 && (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/45 backdrop-blur-[2px]" data-testid="respawn-countdown">
        <div className="rounded-3xl border border-red-400/40 bg-black/70 px-10 py-6 text-center shadow-2xl">
          <p className="text-sm font-black tracking-[0.35em] text-red-400">BUSTED</p>
          <p className="mt-1 text-white/70">{hud.lives} {hud.lives === 1 ? 'car' : 'cars'} left · back on the road in</p>
          <p key={hud.respawnIn} className="mt-1 animate-[pop_0.45s_ease-out] text-7xl font-black text-white" style={{ textShadow: '0 0 24px rgba(255,138,31,0.7)' }}>
            {hud.respawnIn}
          </p>
        </div>
      </div>
    )}
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 text-white sm:p-4" data-testid="hud">
      {/* Left: where */}
      <div className={`${glass} hidden max-w-[34%] px-4 py-3 md:block`}>
        <p className="text-[10px] uppercase tracking-[0.25em] text-orange-300">{mode === 'daily' ? "Today's heist" : 'Free play'}</p>
        <p className="mt-0.5 text-lg font-extrabold leading-tight">{city.city}</p>
        <p className="text-xs text-white/60">{city.name}</p>
        <p className="mt-2 text-sm">
          <span className="mr-1">{weatherEmoji(weather)}</span>
          <span className="capitalize">{weather.description.replace(' (mock)', '')}</span>
          <span className="ml-1 text-white/60">{weather.tempC}°C</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ruleBadges(weather).map((b) => (
            <span key={b} className="rounded-full bg-fuchsia-400/20 px-2 py-0.5 text-[10px] text-fuchsia-100">{b}</span>
          ))}
        </div>
      </div>

      {/* Centre: score, loot, safehouse */}
      <div className="mx-auto flex flex-col items-center gap-2">
        <div className={`${glass} px-6 py-2 text-center`}>
          <p className="font-mono text-3xl font-black tabular-nums" data-testid="hud-score" style={{ textShadow: '0 0 14px rgba(255,138,31,0.6)' }}>
            {(hud?.score ?? 0).toLocaleString('en-US')}
          </p>
          <div className="mt-1 flex justify-center gap-1" aria-label={`${hud?.lootTaken ?? 0} of ${hud?.lootTotal ?? 10} loot`}>
            {Array.from({ length: hud?.lootTotal ?? 10 }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rotate-45 ${i < (hud?.lootTaken ?? 0) ? 'bg-amber-300 shadow-[0_0_8px_#fcd34d]' : 'border border-white/30'}`}
              />
            ))}
          </div>
        </div>
        {ghostName && hud && hud.ghostScore !== null && (
          <div className={`${glass} border-cyan-300/50 px-4 py-1 text-sm`} data-testid="ghost-race">
            👻 <span className="text-cyan-200">{ghostName}</span>{' '}
            <span className="font-mono tabular-nums">{hud.ghostScore.toLocaleString('en-US')}</span>{' '}
            <span className={`ml-1 font-bold ${hud.score >= hud.ghostScore ? 'text-emerald-300' : 'text-red-300'}`}>
              {hud.score >= hud.ghostScore ? `+${(hud.score - hud.ghostScore).toLocaleString('en-US')} ahead` : `${(hud.ghostScore - hud.score).toLocaleString('en-US')} behind`}
            </span>
          </div>
        )}
        <div className={`${glass} px-4 py-1.5 text-sm font-semibold ${hud?.exitOpen ? 'border-emerald-400/60 text-emerald-300' : 'text-white/80'}`}>
          {hud?.exitOpen ? '🟢 Safehouse open: get to the H' : `🔒 ${need} more loot to open the safehouse`}
        </div>
        {hud?.radio && (
          <div className={`${glass} max-w-md border-sky-400/40 px-4 py-1.5 text-center text-sm italic text-sky-100`} data-testid="radio-subtitle">
            📻 “{hud.radio}”
          </div>
        )}
        {hud?.wanted && (
          <div className="animate-pulse rounded-xl bg-red-600/90 px-5 py-1.5 text-sm font-black tracking-[0.3em] shadow-[0_0_24px_rgba(220,38,38,0.8)]">
            WANTED
          </div>
        )}
      </div>

      {/* Right: time + lives */}
      <div className={`${glass} px-4 py-3 text-right`}>
        <p className={`font-mono text-3xl font-black tabular-nums ${low ? 'animate-pulse text-red-400' : ''}`}>{clock}</p>
        <div className="mt-1 flex justify-end gap-1 text-lg" aria-label={`${hud?.lives ?? 3} lives left`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < (hud?.lives ?? 3) ? '' : 'opacity-20 grayscale'}>🚗</span>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
