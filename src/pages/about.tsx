/** Static "How it works" page (prerendered for SEO). */
import { Link } from 'react-router-dom'
import { BACKDROP, primaryBtn } from '../components/brand'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const STEPS: Array<[string, string, string]> = [
  ['🗺️', 'Real streets', '20 city districts traced from OpenStreetMap: the roads you drive are the real ones.'],
  ['💎', 'The heist', 'Grab the loot, open the safehouse, get there before the cops box you in. Three cars, three minutes.'],
  ['🌦️', 'Live weather', "Each city's real weather changes the rules: rain makes you slide, fog shortens the cops' sight, night darkens the map."],
  ['🔥', 'Gadgets', 'Nitro, oil slicks and a disguise (5 s invisible and uncatchable), with crates on the map to refill them.'],
  ['👻', 'Race the ghost', "Drive against the board leader's actual run, replayed next to you."],
  ['✅', 'Fair scores', 'The server replays every run with the same deterministic engine before a score reaches the board.'],
]

export default function About() {
  return (
    <>
      <Seo {...seo} path="/about" />
      <main className="min-h-screen px-4 py-16 text-[#ece6ff]" style={{ background: BACKDROP }}>
        <div className="mx-auto max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.3em] text-orange-300">How it works</p>
          <h1 className="mt-1 text-4xl font-black sm:text-5xl" style={{ textShadow: '0 0 24px rgba(255,138,31,0.5)' }}>City Chase</h1>
          <p className="mt-4 max-w-xl text-white/75">A getaway heist on real city streets. No sign-in needed to play; sign in to keep your scores and get #1 alerts.</p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {STEPS.map(([icon, title, body]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-black/45 p-5 backdrop-blur">
                <p className="text-2xl">{icon}</p>
                <h2 className="mt-2 font-bold">{title}</h2>
                <p className="mt-1 text-sm text-white/65">{body}</p>
              </div>
            ))}
          </div>
          <Link to="/" className={`${primaryBtn} mt-10 inline-block`}>▶ Play now</Link>
        </div>
      </main>
    </>
  )
}
