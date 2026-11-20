/**
 * Top nav for the non-game pages (the lobby and the game are full-screen):
 * nav.ts-driven links (with role filtering), sign-in via <AuthOverlay>, and
 * sign-out, in the City Chase neon style. Keep the data-testid hooks
 * (`app-navigation`, `nav-sign-in-button`, `nav-user-name`, `nav-user-email`)
 * — the shipped tests rely on them. `nav-user-email` is the one that carries
 * an identity the test can check exactly: a display name is optional, the
 * email is the credential the session was opened with.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, signOut } from 'deepspace'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { APP_NAME } from '../constants'
import type { Role } from '../constants'
import { nav } from '../nav'
import { cn } from '../lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const profileReady = !isSignedIn || (!userLoading && !!user)
  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'

  // Close the mobile menu when navigating
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (item.devOnly && !import.meta.env.DEV) return false
    if (!item.roles) return true
    if (!profileReady) return false
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  const navLink = (item: (typeof nav)[number]) => {
    const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm transition',
          active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
        )}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <>
      <nav data-testid="app-navigation" className="dark border-b border-white/10 bg-[#07030f]/95 text-white backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="text-lg font-black tracking-tight" style={{ textShadow: '0 0 16px #ff8a1f' }} aria-label={APP_NAME}>
            CITY CHASE
          </Link>

          <div className="hidden items-center md:flex">{visibleNav.map(navLink)}</div>

          <div className="flex-1" />

          {!isLoaded ? null : isSignedIn && !profileReady ? (
            /* Signed in, profile still loading — skeleton pill, never the
               Sign in button (that would offer sign-in to a signed-in user). */
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5">
              <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
              <div className="hidden h-4 w-20 animate-pulse rounded-md bg-muted sm:block" />
            </div>
          ) : isSignedIn && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Account menu"
                    className="group flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pl-1 pr-2.5 text-sm text-white transition-colors hover:bg-white/10"
                  >
                    <Avatar className="h-6 w-6 ring-1 ring-inset ring-border">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[11px]">
                        {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      data-testid="nav-user-name"
                      className="hidden max-w-[140px] truncate text-white sm:inline"
                    >
                      {user.name || user.email}
                    </span>
                    <ChevronDown
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate font-medium text-foreground">
                    {user.name || 'Signed in'}
                  </div>
                  <div
                    data-testid="nav-user-email"
                    className="truncate text-xs font-normal text-muted-foreground"
                  >
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              data-testid="nav-sign-in-button"
              onClick={() => setShowAuthModal(true)}
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-bold text-black shadow-[0_0_18px_rgba(255,138,31,0.5)] hover:bg-orange-400"
            >
              Sign in
            </button>
          )}

          <button
            className="inline-flex h-8 w-8 items-center justify-center text-white/60 hover:text-white md:hidden"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="flex flex-col gap-1 border-t border-white/10 px-2 py-2 md:hidden">
            {visibleNav.map(navLink)}
          </div>
        )}
      </nav>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </>
  )
}
