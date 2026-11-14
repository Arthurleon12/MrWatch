import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { PageSkeleton } from './AppShell'
import { CalendarIcon, SearchIcon, SparkleIcon, TvIcon, UserIcon } from './icons'

const tabs = [
  { to: '/', label: 'Up Next', icon: TvIcon },
  { to: '/schedule', label: 'Schedule', icon: CalendarIcon },
  { to: '/foryou', label: 'For You', icon: SparkleIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/profile', label: 'Profile', icon: UserIcon },
]

export function Layout() {
  return (
    // the body already pads the notch, so a full 100dvh here would make every
    // short screen scroll by exactly the notch height
    <div className="mx-auto min-h-[calc(100dvh-env(safe-area-inset-top,0px))] max-w-lg">
      <main className="safe-bottom">
        {/* screens load on demand; the tab bar stays put while one arrives */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur tabbar-safe"
      >
        <div className="mx-auto flex max-w-lg">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium tracking-wide transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-faint hover:text-ink-soft'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
