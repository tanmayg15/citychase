/** In-game heads-up display: loot, safehouse state, wanted level, lives, time. */
import type { Hud } from './GameCanvas'

export function HudBar({ hud }: { hud: Hud }) {
  const need = Math.max(0, hud.lootToOpen - hud.lootTaken)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm" data-testid="hud-bar">
      <span data-testid="hud-score">{hud.score.toLocaleString('en-US')} pts</span>
      <span className="text-yellow-300">◆ {hud.lootTaken}/{hud.lootTotal}</span>
      <span className={hud.exitOpen ? 'text-emerald-300' : 'opacity-70'}>
        {hud.exitOpen ? 'Safehouse OPEN: get to H' : `Safehouse opens in ${need} loot`}
      </span>
      {hud.wanted && <span className="animate-pulse font-bold text-red-400">WANTED</span>}
      <span className="opacity-80">{'🚗'.repeat(Math.max(0, hud.lives))}</span>
      <span>{hud.secondsLeft}s</span>
    </div>
  )
}
