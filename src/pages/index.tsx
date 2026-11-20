/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-[#e8e0ff]"
        style={{ background: '#07030f' }}
      >
        <p className="mb-3 text-xs uppercase tracking-[0.4em] text-fuchsia-300/80">City Chase</p>
        <h1 className="mb-4 max-w-2xl text-4xl font-black tracking-tight sm:text-6xl" style={{ textShadow: '0 0 24px #8b5cf6' }}>
          Real streets. Live weather. Cops that learn.
        </h1>
        <p className="mb-8 max-w-md opacity-75">
          A top-down getaway heist on a real city&apos;s streets. One city a day, the same for everyone. Grab the loot,
          lose the cops, reach the safehouse. Every score is verified by replaying the run on the server.
        </p>
        <Link
          to="/home"
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-6 py-3 font-bold text-black shadow-[0_0_24px_#37f5ff] hover:bg-cyan-300"
        >
          Start today&apos;s heist
        </Link>
        <p className="mt-10 text-xs opacity-40">Map data © OpenStreetMap contributors (ODbL).</p>
      </div>
    </>
  )
}
