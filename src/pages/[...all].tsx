import { Link } from 'react-router-dom'
import { BACKDROP, primaryBtn } from '../components/brand'
import { APP_NAME } from '../constants'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center text-[#ece6ff]" style={{ background: BACKDROP }}>
      <title>{`Not found · ${APP_NAME}`}</title>
      <meta name="robots" content="noindex" />
      <p className="text-[11px] uppercase tracking-[0.3em] text-orange-300">Wrong turn</p>
      <h1 className="mt-2 text-7xl font-black" style={{ textShadow: '0 0 30px rgba(255,138,31,0.6)' }}>404</h1>
      <p className="mt-3 max-w-sm text-white/65">This street isn't on any of our maps. The cops lost you, at least.</p>
      <Link to="/" className={`${primaryBtn} mt-8`}>▶ Back to the lobby</Link>
    </div>
  )
}
