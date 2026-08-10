import { Link } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { useTrackedShowDetails } from '../queries'
import { dayLabel, epCode, episodeAirTime, shortDate, timeOfDay } from '../lib/time'
import { Poster } from '../components/Poster'
import type { TvmEpisode, TvmShow } from '../types'

interface Upcoming {
  show: TvmShow
  ep: TvmEpisode
  at: Date
}

const HORIZON_DAYS = 90

export function SchedulePage() {
  const { shows } = useLibrary()
  const trackedIds = Object.keys(shows).map(Number)
  const queries = useTrackedShowDetails(trackedIds)

  const now = new Date()
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000)
  const upcoming: Upcoming[] = []
  const waitingForDate: TvmShow[] = []
  const isLoading = queries.some((q) => q.isLoading)

  for (const q of queries) {
    if (!q.data) continue
    const show = q.data
    const future = (show._embedded?.episodes ?? [])
      .map((ep) => ({ ep, at: episodeAirTime(ep) }))
      .filter((x): x is { ep: TvmEpisode; at: Date } => x.at !== null && x.at > now)

    for (const { ep, at } of future) {
      if (at <= horizon) upcoming.push({ show, ep, at })
    }
    const stillGoing = show.status === 'Running' || show.status === 'To Be Determined' || show.status === 'In Development'
    if (future.length === 0 && stillGoing) waitingForDate.push(show)
  }

  upcoming.sort((a, b) => a.at.getTime() - b.at.getTime())

  const byDay = new Map<string, Upcoming[]>()
  for (const item of upcoming) {
    const key = item.at.toDateString()
    const list = byDay.get(key) ?? []
    list.push(item)
    byDay.set(key, list)
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Schedule</h1>

      {isLoading && <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface" />}

      {!isLoading && upcoming.length === 0 && trackedIds.length > 0 && (
        <p className="mt-6 text-sm text-ink-soft">
          Nothing on the calendar for the next {HORIZON_DAYS} days.
        </p>
      )}
      {!isLoading && trackedIds.length === 0 && (
        <p className="mt-6 text-sm text-ink-soft">
          Track some shows and their upcoming episodes will show up here.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {[...byDay.entries()].map(([key, items]) => {
          const day = items[0].at
          const label = dayLabel(day)
          const date = shortDate(day)
          return (
            <section key={key}>
              <h2 className="flex items-baseline gap-2 font-display text-sm font-bold">
                {label}
                {label !== date && (
                  <span className="text-xs font-medium text-ink-faint">{date}</span>
                )}
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {items.map(({ show, ep, at }) => (
                  <Link
                    key={ep.id}
                    to={`/show/${show.id}`}
                    className="flex items-center gap-3 rounded-xl bg-surface p-2.5"
                  >
                    <Poster src={show.image?.medium} alt="" className="h-14 w-10 flex-none rounded-md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-bold">{show.name}</p>
                      <p className="truncate text-xs text-ink-soft">
                        <span className="font-medium text-accent">{epCode(ep)}</span>
                        {ep.name ? ` · ${ep.name}` : ''}
                      </p>
                    </div>
                    <span className="flex-none text-xs font-medium text-ink-faint">{timeOfDay(at)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {waitingForDate.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            Waiting for a date
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Still in production — no announced air date yet.
          </p>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {waitingForDate.map((show) => (
              <Link key={show.id} to={`/show/${show.id}`} className="w-20 flex-none">
                <Poster src={show.image?.medium} alt={show.name} className="h-28 w-20 rounded-lg" />
                <p className="mt-1 truncate text-[0.68rem] text-ink-soft">{show.name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
