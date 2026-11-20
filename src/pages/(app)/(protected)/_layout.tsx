/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { BACKDROP, primaryBtn } from '@/components/brand'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-20 text-[#ece6ff]" style={{ background: BACKDROP }}>
      <div className="w-full max-w-sm rounded-2xl border border-orange-400/30 bg-black/50 p-8 text-center shadow-2xl backdrop-blur-md">
        <p className="text-4xl">🔐</p>
        <h1 className="mt-3 text-2xl font-black">Sign in to continue</h1>
        <p className="mt-2 text-sm text-white/60">This page needs an account. Playing never does.</p>
        <button className={`${primaryBtn} mt-6 w-full`} onClick={() => setShowAuthModal(true)} data-testid="protected-sign-in">
          Sign in
        </button>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline-offset-4 hover:text-white hover:underline">
          ← Back to the lobby
        </Link>
      </div>

      {showAuthModal && <AuthOverlay providers={['google', 'github']} onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
