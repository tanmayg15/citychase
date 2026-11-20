/**
 * Debug viewer for the generated city mazes (Phase 2 checkpoint).
 * Static page: pure SVG, no providers, safe to prerender.
 */
import { CITY_MAZES, type CityMaze } from '@/cities'

const TILE = 16

const COLORS = {
  bg: '#0b0618',
  wall: '#2a1457',
  wallEdge: '#7b3fe4',
  orb: '#ffe066',
  core: '#ff4fd8',
  player: '#37f5ff',
  ghost: '#ff6b3d',
}

function MazeSvg({ city }: { city: CityMaze }) {
  const h = city.rows.length
  const w = city.rows[0].length
  const shapes: React.ReactNode[] = []
  city.rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x]
      const cx = x * TILE + TILE / 2
      const cy = y * TILE + TILE / 2
      const k = `${x},${y}`
      if (ch === '#') {
        shapes.push(<rect key={k} x={x * TILE} y={y * TILE} width={TILE} height={TILE} fill={COLORS.wall} stroke={COLORS.wallEdge} strokeWidth={0.5} />)
      } else if (ch === '.') {
        shapes.push(<circle key={k} cx={cx} cy={cy} r={2} fill={COLORS.orb} />)
      } else if (ch === 'o') {
        shapes.push(<circle key={k} cx={cx} cy={cy} r={5} fill={COLORS.core} />)
      } else if (ch === 'P') {
        shapes.push(<circle key={k} cx={cx} cy={cy} r={6} fill={COLORS.player} />)
      } else if (ch === 'G') {
        shapes.push(<rect key={k} x={cx - 5} y={cy - 5} width={10} height={10} rx={3} fill={COLORS.ghost} />)
      }
    }
  })
  return (
    <svg
      viewBox={`0 0 ${w * TILE} ${h * TILE}`}
      className="h-auto w-full rounded-lg"
      style={{ background: COLORS.bg }}
      role="img"
      aria-label={`${city.name}, ${city.city} maze`}
    >
      {shapes}
    </svg>
  )
}

export default function MazeViewer() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" style={{ background: COLORS.bg, color: '#e8e0ff', minHeight: '100vh' }}>
      <h1 className="mb-1 text-2xl font-bold">City mazes (debug)</h1>
      <p className="mb-6 text-sm opacity-70">
        Generated offline from OpenStreetMap by <code>scripts/mazes/build-mazes.mjs</code>.
        Cyan = player spawn, orange = ghost spawns, pink = power cores, yellow = orbs.
      </p>
      <div className="grid gap-8 md:grid-cols-2">
        {CITY_MAZES.map((c) => (
          <section key={c.id} data-testid={`maze-${c.id}`}>
            <h2 className="mb-1 text-lg font-semibold">{c.name}, {c.city}</h2>
            <p className="mb-2 text-xs opacity-70">
              {c.id} · rotated {c.bearingDeg}° · {c.cellMeters} m per node · {c.stats.orbs} orbs ·{' '}
              {c.stats.junctions} junctions · {c.stats.corridors}/{c.stats.maxCorridors} links ·{' '}
              {c.stats.prunedDeadEnds} dead ends pruned
            </p>
            <MazeSvg city={c} />
          </section>
        ))}
      </div>
      <p className="mt-8 text-xs opacity-60">Map data © OpenStreetMap contributors (ODbL).</p>
    </main>
  )
}
