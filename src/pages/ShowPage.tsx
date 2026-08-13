import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useShow } from '../queries'
import {
  setEpisodeRating,
  setEpisodeWatched,
  setManyWatched,
  trackShow,
  untrackShow,
  useLibrary,
} from '../store/library'
import { useProfile } from '../store/profile'
import { stripHtml } from '../api/tvmaze'
import { epCode, hasAired, shortDate, episodeAirTime } from '../lib/time'
import { compactCount } from '../lib/format'
import { Poster } from '../components/Poster'
import { CheckIcon, ChevronLeftIcon, PlusIcon } from '../components/icons'
import type { TvmEpisode } from '../types'

export function ShowPage() {
  const { id } = useParams()
  const showId = Number(id)
  const navigate = useNavigate()
  const { data: show, isLoading, isError } = useShow(showId)
  const { shows: tracked, watched, ratings } = useLibrary()
  const [expandSummary, setExpandSummary] = useState(false)
  const [ratingEpId, setRatingEpId] = useState<number | null>(null)
  const [ratingDraft, setRatingDraft] = useState(7)

  const isTracked = showId in tracked
  const watchedSet = useMemo(() => new Set(watched[showId] ?? []), [watched, showId])
  const ladderPos = useProfile().top10Shows.findIndex((s) => s.id === showId)

  const seasons = useMemo(() => {
    const eps = [...(show?._embedded?.episodes ?? [])].sort(
      (a, b) => a.season - b.season || (a.number ?? 0) - (b.number ?? 0),
    )
    const map = new Map<number, TvmEpisode[]>()
    for (const ep of eps) {
      const list = map.get(ep.season) ?? []
      list.push(ep)
      map.set(ep.season, list)
    }
    // latest season first — that's the one you came for on an ongoing show
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [show])

  if (isLoading) {
    return <div className="px-4 pt-6"><div className="h-48 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (isError || !show) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">Couldn't load this show. Check your connection and try again.</p>
        <Link to="/" className="mt-3 inline-block text-sm text-accent">Back to Up Next</Link>
      </div>
    )
  }

  const allEpisodes = show._embedded?.episodes ?? []
  const airedEpisodes = allEpisodes.filter((ep) => hasAired(ep))
  const watchedCount = airedEpisodes.filter((ep) => watchedSet.has(ep.id)).length
  const network = show.network?.name ?? show.webChannel?.name
  const years = `${show.premiered?.slice(0, 4) ?? '—'}–${show.ended?.slice(0, 4) ?? ''}`
  const summary = stripHtml(show.summary)

  return (
    <div>
      <div className="relative px-4 pt-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>

        <div className="flex gap-4">
          <Poster src={show.image?.medium} alt="" className="h-36 w-24 flex-none rounded-xl" />
          <div className="min-w-0 pt-1">
            <h1 className="font-display text-xl font-bold leading-tight">{show.name}</h1>
            <p className="mt-1 text-xs text-ink-soft">
              {[network, years, show.status].filter(Boolean).join(' · ')}
            </p>
            {show.genres.length > 0 && (
              <p className="mt-1 text-xs text-ink-faint">{show.genres.join(' · ')}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => (isTracked ? untrackShow(show.id) : trackShow(show))}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-xs font-bold transition-colors ${
                  isTracked ? 'bg-surface text-ink-soft' : 'bg-accent text-bg'
                }`}
              >
                {isTracked ? <CheckIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
                {isTracked ? 'Tracking' : 'Track show'}
              </button>
              {isTracked && (
                <Link
                  to={`/rank/${show.id}`}
                  className="rounded-full border-2 border-accent px-4 py-1.5 font-display text-xs font-bold text-accent"
                >
                  {ladderPos >= 0 ? `Ranked #${ladderPos + 1} · re-rank` : 'Rank it'}
                </Link>
              )}
            </div>
          </div>
        </div>

        {summary && (
          <p
            onClick={() => setExpandSummary((v) => !v)}
            className={`mt-4 text-sm leading-relaxed text-ink-soft ${expandSummary ? '' : 'line-clamp-3'}`}
          >
            {summary}
          </p>
        )}

        {isTracked && airedEpisodes.length > 0 && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-display font-bold text-ink-soft">
                {compactCount(watchedCount)} of {compactCount(airedEpisodes.length)} aired episodes watched
              </span>
              {watchedCount < airedEpisodes.length && (
                <button
                  onClick={() =>
                    setManyWatched(show.id, airedEpisodes.map((e) => e.id), true)
                  }
                  className="font-medium text-accent"
                >
                  Mark all watched
                </button>
              )}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(watchedCount / airedEpisodes.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-6 px-4">
        {seasons.map(([seasonNum, eps]) => {
          const aired = eps.filter((ep) => hasAired(ep))
          const seasonWatched = aired.filter((ep) => watchedSet.has(ep.id)).length
          const allWatched = aired.length > 0 && seasonWatched === aired.length
          return (
            <section key={seasonNum}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-sm font-bold">
                  Season {seasonNum}
                  <span className="ml-2 text-xs font-medium text-ink-faint">
                    {seasonWatched}/{aired.length}
                  </span>
                </h2>
                {aired.length > 0 && (
                  <button
                    onClick={() => setManyWatched(show.id, aired.map((e) => e.id), !allWatched)}
                    className="text-xs font-medium text-accent"
                  >
                    {allWatched ? 'Unmark season' : 'Mark season'}
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-col">
                {eps.map((ep) => {
                  const aired = hasAired(ep)
                  const isWatched = watchedSet.has(ep.id)
                  const airAt = episodeAirTime(ep)
                  const rating = ratings[ep.id]
                  const isRatingOpen = ratingEpId === ep.id
                  return (
                    <div key={ep.id} className="border-b border-line last:border-b-0">
                      <div
                        className={`flex items-center gap-3 py-2.5 ${aired ? '' : 'opacity-50'}`}
                      >
                        <span className="w-12 flex-none text-xs font-medium text-ink-faint">
                          {ep.number === null ? 'SP' : `E${String(ep.number).padStart(2, '0')}`}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${isWatched ? 'text-ink-faint' : 'text-ink'}`}>
                            {ep.name}
                          </p>
                          {airAt && (
                            <p className="text-xs text-ink-faint">
                              {aired ? shortDate(airAt) : `airs ${shortDate(airAt)}`}
                            </p>
                          )}
                        </div>
                        {isWatched && (
                          <button
                            onClick={() => {
                              setRatingEpId(isRatingOpen ? null : ep.id)
                              setRatingDraft(rating ?? 7)
                            }}
                            aria-label={rating ? `Rated ${rating.toFixed(1)} — change rating` : `Rate ${epCode(ep)}`}
                            className={`flex h-8 min-w-8 flex-none items-center justify-center rounded-full px-1.5 font-display text-xs font-bold transition-colors ${
                              rating
                                ? 'bg-raised text-accent'
                                : 'border-2 border-line text-ink-faint active:border-accent'
                            }`}
                          >
                            {rating ? rating.toFixed(1) : '★'}
                          </button>
                        )}
                        {aired ? (
                          <button
                            onClick={() => setEpisodeWatched(show.id, ep.id, !isWatched)}
                            aria-label={`Mark ${epCode(ep)} ${isWatched ? 'unwatched' : 'watched'}`}
                            className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors ${
                              isWatched
                                ? 'bg-accent text-bg'
                                : 'border-2 border-line text-ink-faint active:border-accent'
                            }`}
                          >
                            <CheckIcon className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="h-8 w-8 flex-none" />
                        )}
                      </div>

                      {isRatingOpen && isWatched && (
                        <div className="flex items-center gap-3 pb-3 pl-12">
                          <span className="w-9 flex-none text-center font-display text-lg font-bold text-accent tabular-nums">
                            {ratingDraft.toFixed(1)}
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={10}
                            step={0.1}
                            value={ratingDraft}
                            onChange={(e) => setRatingDraft(Number(e.target.value))}
                            aria-label={`Rating for ${epCode(ep)}`}
                            className="min-w-0 flex-1 accent-accent"
                          />
                          <button
                            onClick={() => {
                              setEpisodeRating(show.id, ep.id, ratingDraft)
                              setRatingEpId(null)
                            }}
                            className="flex-none rounded-full bg-accent px-3.5 py-1.5 font-display text-xs font-bold text-bg"
                          >
                            Save
                          </button>
                          {rating != null && (
                            <button
                              onClick={() => {
                                setEpisodeRating(show.id, ep.id, null)
                                setRatingEpId(null)
                              }}
                              className="flex-none text-xs font-medium text-ink-faint"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
