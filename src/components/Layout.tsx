import { NavLink, Outlet } from 'react-router-dom'
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
    <div className="mx-auto min-h-dvh max-w-lg">
      <main className="safe-bottom">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur tabbar-safe">
        <div className="mx-auto flex max-w-lg">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium tracking-wide transition-colors ${
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
