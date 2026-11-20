/** Static "How it works" page (prerendered for SEO). */
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function About() {
  return (
    <>
      <Seo {...seo} path="/about" />
      <main className="mx-auto min-h-screen max-w-2xl px-6 py-16 text-[#ece6ff]" style={{ background: '#07030f' }}>
        <h1 className="text-4xl font-black">How City Chase works</h1>
        <p className="mt-4 opacity-80">A top-down getaway heist on real city streets from OpenStreetMap. Grab the loot, reach the safehouse, stay out of the headlights. Each city's live weather changes the rules.</p>
        <p className="mt-4 opacity-80">Play without signing in. Sign in afterwards to save your run: the server replays it with the same deterministic engine and records the verified score.</p>
        <Link to="/" className="mt-8 inline-block rounded-lg bg-orange-500 px-6 py-3 font-bold text-black">Play now</Link>
      </main>
    </>
  )
}
