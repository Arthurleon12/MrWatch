import { Link } from 'react-router-dom'
import { useLibrary, setEpisodeWatched } from '../store/library'
import { useTrackedShowDetails } from '../queries'
import { agoLabel, epCode, episodeAirTime, hasAired } from '../lib/time'
import { Poster } from '../components/Poster'
import { CheckIcon, SearchIcon } from '../components/icons'
import type { TvmEpisode, TvmShow } from '../types'

interface QueueEntry {
  show: TvmShow
  next: TvmEpisode
  remaining: number
}

function sortedEpisodes(show: TvmShow): TvmEpisode[] {
  return [...(show._embedded?.episodes ?? [])].sort(
    (a, b) => a.season - b.season || (a.number ?? 0) - (b.number ?? 0),
  )
}

export function UpNextPage() {
  const { shows, watched } = useLibrary()
  const trackedIds = Object.values(shows)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((s) => s.id)
  const queries = useTrackedShowDetails(trackedIds)

  const queue: QueueEntry[] = []
  const caughtUp: TvmShow[] = []
  let loadingCount = 0
  const errored = queries.filter((q) => q.isError)

  for (const q of queries) {
    if (q.isLoading) {
      loadingCount++
      continue
    }
    if (!q.data) continue
    const show = q.data
    const watchedSet = new Set(watched[show.id] ?? [])
    const airedUnwatched = sortedEpisodes(show).filter(
      (ep) => hasAired(ep) && !watchedSet.has(ep.id),
    )
    if (airedUnwatched.length > 0) {
      queue.push({ show, next: airedUnwatched[0], remaining: airedUnwatched.length - 1 })
    } else {
      caughtUp.push(show)
    }
  }

  // freshest releases first
  queue.sort(
    (a, b) =>
      (episodeAirTime(b.next)?.getTime() ?? 0) - (episodeAirTime(a.next)?.getTime() ?? 0),
  )

  return (
    <div className="px-4 pt-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Up Next</h1>

      {errored.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-ink-soft">
            {errored.length === queries.length ? 'Your shows' : `${errored.length} of your shows`}{' '}
            couldn't load — check your connection.
          </p>
          <button
            onClick={() => errored.forEach((q) => void q.refetch())}
            className="flex-none rounded-full bg-accent px-4 py-1.5 font-display text-xs font-bold text-bg"
          >
            Retry
          </button>
        </div>
      )}

      {trackedIds.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="max-w-60 text-sm text-ink-soft">
            Track a few shows and your watch queue will live here.
          </p>
          <Link
            to="/search"
            className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-bg"
          >
            <SearchIcon className="h-4 w-4" />
            Find your shows
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {queue.map(({ show, next, remaining }) => {
          const airedAt = episodeAirTime(next)
          return (
            <div key={show.id} className="flex items-center gap-3 rounded-xl bg-surface p-3">
              <Link to={`/show/${show.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Poster
                  src={show.image?.medium}
                  alt=""
                  className="h-20 w-14 flex-none rounded-lg"
                />
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-bold">{show.name}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">
                    <span className="font-medium text-accent">{epCode(next)}</span>
                    {' · '}
                    {next.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {airedAt ? `out ${agoLabel(airedAt)}` : 'aired'}
                    {remaining > 0 && ` · +${remaining} more`}
                  </p>
                </div>
              </Link>
              <button
                onClick={() => setEpisodeWatched(show.id, next.id, true)}
                aria-label={`Mark ${show.name} ${epCode(next)} watched`}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-accent text-accent transition-colors active:bg-accent active:text-bg"
              >
                <CheckIcon className="h-5 w-5" />
              </button>
            </div>
          )
        })}

        {loadingCount > 0 &&
          Array.from({ length: loadingCount }).map((_, i) => (
            <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-surface" />
          ))}
      </div>

      {caughtUp.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            All caught up
          </h2>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {caughtUp.map((show) => (
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
