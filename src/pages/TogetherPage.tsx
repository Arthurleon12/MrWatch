import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { useLibrary } from '../store/library'
import { useProfile } from '../store/profile'
import { useTmdbKey } from '../store/settings'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import {
  useMovieGenreMap,
  useMyTasteSnapshot,
  useFriendTasteSnapshot,
  useNowPlaying,
  useScheduleWindow,
  useTrackedShowDetails,
} from '../queries'
import { computeTasteMatch, scoreTitleForPair } from '../lib/match'
import { EXCLUDED_TYPES } from '../lib/recommend'
import { getMovieRecommendations, tmdbImage, type TmdbMovie } from '../api/tmdb'
import { Poster } from '../components/Poster'
import { ChevronLeftIcon, SparkleIcon, UserIcon } from '../components/icons'
import type { TvmShow } from '../types'

/**
 * MrWatch AI — pick something to watch *together*.
 *
 * Takes two friends' real histories, shows a Taste Match score, then picks
 * movies (and shows) that fit BOTH tastes — least-misery, not average — and
 * skips everything either person has already seen.
 */
export function TogetherPage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const me = useProfile()
  const { shows: myShows } = useLibrary()
  const tmdbKey = useTmdbKey()

  const mine = useMyTasteSnapshot()
  const theirs = useFriendTasteSnapshot(username, !!session)
  const friend = theirs.friend

  /* ---------------- movie candidates: recs from both + in theaters ------- */
  const seedIds = useMemo(() => {
    const pick = (ladder: { id: number }[], watched: { id: number }[]) =>
      [...ladder.map((m) => m.id), ...watched.map((m) => m.id)].slice(0, 2)
    const a = pick(mine.snapshot.ladderMovies, mine.snapshot.watchedMovies)
    const b = theirs.snapshot ? pick(theirs.snapshot.ladderMovies, theirs.snapshot.watchedMovies) : []
    return [...new Set([...a, ...b])].slice(0, 4)
  }, [mine.snapshot, theirs.snapshot])

  const recQueries = useQueries({
    queries: seedIds.map((id) => ({
      queryKey: ['movie-recs', id],
      queryFn: () => getMovieRecommendations(id, tmdbKey),
      enabled: tmdbKey.length > 0,
      staleTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  })
  const { data: nowPlaying } = useNowPlaying(tmdbKey)
  const { data: genreMap } = useMovieGenreMap(tmdbKey)

  const moviePicks = useMemo(() => {
    const a = mine.snapshot
    const b = theirs.snapshot
    if (!b) return []
    const seenByEither = new Set([...a.watchedMovies, ...b.watchedMovies].map((m) => m.id))
    const wantMine = new Set(a.wantMovies.map((m) => m.id))
    const wantTheirs = new Set(b.wantMovies.map((m) => m.id))

    const pool = new Map<number, TmdbMovie>()
    for (const q of recQueries) for (const m of q.data ?? []) if (!pool.has(m.id)) pool.set(m.id, m)
    for (const m of nowPlaying ?? []) if (!pool.has(m.id)) pool.set(m.id, m)

    const genreNames = (m: TmdbMovie) =>
      (m.genre_ids ?? []).map((id) => genreMap?.get(id)).filter((g): g is string => !!g)

    return [...pool.values()]
      .filter((m) => !seenByEither.has(m.id) && m.poster_path)
      .map((m) => {
        const score = scoreTitleForPair(
          { genres: genreNames(m), voteAverage: m.vote_average },
          a,
          b,
        )
        const onList = wantMine.has(m.id) ? 'you' : wantTheirs.has(m.id) ? `@${b.username}` : null
        // a movie one of you already shortlisted is a great group candidate
        return { movie: m, ...score, joint: score.joint + (onList ? 0.08 : 0), onList }
      })
      .sort((x, y) => y.joint - x.joint)
      .slice(0, 9)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mine.snapshot,
    theirs.snapshot,
    nowPlaying,
    genreMap,
    recQueries.map((q) => q.dataUpdatedAt).join(','),
  ])

  /* ---------------- shows: their shelf for you + new for both ------------ */
  const friendTrackIds = (friend?.tracks ?? []).slice(0, 30).map((t) => t.show_id)
  const friendDetailQueries = useTrackedShowDetails(friendTrackIds)

  const shelfPicks = useMemo(() => {
    const b = theirs.snapshot
    if (!b) return []
    return friendDetailQueries
      .map((q) => q.data)
      .filter((d): d is TvmShow => !!d && !(d.id in myShows) && !!d.image)
      .map((show) => ({
        show,
        forYou: scoreTitleForPair(
          { genres: show.genres, voteAverage: show.rating?.average ?? 0 },
          mine.snapshot,
          b,
        ).forA,
      }))
      .sort((x, y) => y.forYou - x.forYou)
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.snapshot, theirs.snapshot, myShows, friendDetailQueries.map((q) => q.dataUpdatedAt).join(',')])

  const windowQueries = useScheduleWindow()
  const newForBoth = useMemo(() => {
    const a = mine.snapshot
    const b = theirs.snapshot
    if (!b) return []
    const eitherTracks = new Set([
      ...a.trackedShows.map((s) => s.id),
      ...b.trackedShows.map((s) => s.id),
    ])
    const byId = new Map<number, TvmShow>()
    for (const q of windowQueries) {
      for (const item of q.data ?? []) {
        const show = item.show ?? item._embedded?.show
        if (show && !byId.has(show.id)) byId.set(show.id, show)
      }
    }
    return [...byId.values()]
      .filter(
        (s) =>
          !eitherTracks.has(s.id) &&
          !!s.image &&
          !!s.summary &&
          !(s.type && EXCLUDED_TYPES.has(s.type)),
      )
      .map((show) => ({
        show,
        score: scoreTitleForPair(
          { genres: show.genres, voteAverage: show.rating?.average ?? 0 },
          a,
          b,
        ),
      }))
      .sort((x, y) => y.score.joint - x.score.joint)
      .slice(0, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.snapshot, theirs.snapshot, windowQueries.map((q) => q.dataUpdatedAt).join(',')])

  /* ------------------------------- guards -------------------------------- */
  if (!supabase) return <Navigate to="/" replace />
  if (!session) return <Navigate to="/auth" replace />
  if (username.toLowerCase() === me.username.toLowerCase()) return <Navigate to="/profile" replace />

  if (theirs.isLoading) {
    return <div className="px-4 pt-6"><div className="h-52 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (!friend) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">No one here by that name.</p>
        <Link to="/search" className="mt-3 inline-block text-sm text-accent">Find people</Link>
      </div>
    )
  }

  const match = theirs.snapshot ? computeTasteMatch(mine.snapshot, theirs.snapshot) : null
  const ready = mine.ready && theirs.ready
  const headline = moviePicks[0]
  const alsoGood = moviePicks.slice(1)

  const avatar = (src: string | null) => (
    <span className="h-14 w-14 flex-none overflow-hidden rounded-full border-2 border-bg bg-raised">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-faint">
          <UserIcon className="h-6 w-6" />
        </span>
      )}
    </span>
  )

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      {/* ---- taste match hero ---- */}
      <div className="mt-4 rounded-2xl bg-surface p-5 text-center">
        <div className="flex items-center justify-center">
          {avatar(me.avatar)}
          <span className="-mx-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-bg">
            <SparkleIcon className="h-4 w-4" />
          </span>
          {avatar(friend.avatarUrl)}
        </div>
        <p className="mt-2 font-display text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-faint">
          MrWatch AI · you + @{friend.username}
        </p>
        {ready && match ? (
          <>
            <p className="mt-1 font-display text-5xl font-bold text-accent tabular-nums">
              {match.percent}%
            </p>
            <p className="font-display text-sm font-bold">Taste Match</p>
            {match.sharedGenres.length > 0 && (
              <p className="mt-1.5 text-xs text-ink-soft">
                You both live for {match.sharedGenres.join(' · ')}
              </p>
            )}
            <p className="mt-1 text-[0.68rem] text-ink-faint">
              {[
                match.sharedShows.length > 0 ? `${match.sharedShows.length} shows in common` : null,
                match.sharedMovies.length > 0 ? `${match.sharedMovies.length} movies you've both seen` : null,
                match.ladderAgreements.length > 0
                  ? `${match.ladderAgreements[0].name} on both ladders`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Two histories, one score'}
            </p>
            {!match.hasEnoughData && (
              <p className="mt-2 text-[0.68rem] text-ink-faint">
                Early days — the score sharpens as you both track and rank more.
              </p>
            )}
          </>
        ) : (
          <div className="mx-auto mt-3 h-12 w-24 animate-pulse rounded-lg bg-raised" />
        )}
      </div>

      {/* ---- tonight's pick ---- */}
      <section className="mt-7">
        <h2 className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
          <SparkleIcon className="h-3.5 w-3.5 text-accent" />
          Tonight's movie, chosen for you two
        </h2>
        <p className="mt-1 text-[0.68rem] text-ink-faint">
          Fits both tastes · skips everything either of you has seen.
        </p>

        {!tmdbKey ? (
          <div className="mt-3 rounded-xl border border-line bg-surface p-4">
            <p className="text-xs leading-relaxed text-ink-soft">
              Movie picks need the TMDB catalog — connect a free key and MrWatch AI takes it from
              there.
            </p>
            <Link to="/profile" className="mt-1.5 inline-block text-xs font-bold text-accent">
              Connect in Profile →
            </Link>
          </div>
        ) : !ready ? (
          <div className="mt-3 h-40 animate-pulse rounded-xl bg-surface" />
        ) : headline ? (
          <>
            <Link
              to={`/movie/${headline.movie.id}`}
              className="mt-3 flex gap-3.5 rounded-2xl border border-accent/40 bg-surface p-3.5"
            >
              <Poster
                src={tmdbImage(headline.movie.poster_path)}
                alt=""
                kind="movie"
                className="h-40 w-27 flex-none rounded-xl"
              />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="font-display text-base font-bold leading-tight">{headline.movie.title}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {[
                    headline.movie.release_date?.slice(0, 4),
                    headline.movie.vote_average > 0 ? `★ ${headline.movie.vote_average.toFixed(1)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-1.5 font-display text-xs font-bold text-accent">
                  ~{headline.forA}% you · ~{headline.forB}% @{friend.username}
                </p>
                {headline.onList && (
                  <p className="mt-1 text-[0.68rem] font-medium text-good">
                    Already on {headline.onList === 'you' ? 'your' : `${headline.onList}'s`} list
                  </p>
                )}
                <p className="mt-1.5 line-clamp-3 text-xs leading-snug text-ink-soft">
                  {headline.movie.overview}
                </p>
              </div>
            </Link>

            {alsoGood.length > 0 && (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {alsoGood.map(({ movie, forA, forB }) => (
                  <Link key={movie.id} to={`/movie/${movie.id}`} className="w-24 flex-none">
                    <Poster src={tmdbImage(movie.poster_path, 'w154')} alt="" kind="movie" className="h-34 w-24 rounded-lg" />
                    <p className="mt-1 truncate text-[0.68rem] text-ink-soft">{movie.title}</p>
                    <p className="text-[0.62rem] font-medium text-accent">
                      {Math.min(forA, forB)}%+ both
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-faint">
            Not enough movie history between you yet — mark a few movies watched and come back.
          </p>
        )}
      </section>

      {/* ---- their shelf, your taste ---- */}
      {shelfPicks.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            On @{friend.username}'s shelf, matched to you
          </h2>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {shelfPicks.map(({ show, forYou }) => (
              <Link key={show.id} to={`/show/${show.id}`} className="w-24 flex-none">
                <Poster src={show.image?.medium} alt="" className="h-34 w-24 rounded-lg" />
                <p className="mt-1 truncate text-[0.68rem] text-ink-soft">{show.name}</p>
                <p className="text-[0.62rem] font-medium text-accent">~{forYou}% you</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---- brand new for both ---- */}
      {newForBoth.length > 0 && (
        <section className="mt-8 pb-2">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            New this week, for both of you
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {newForBoth.map(({ show, score }) => (
              <Link key={show.id} to={`/show/${show.id}`} className="flex items-center gap-3 rounded-xl bg-surface p-2.5">
                <Poster src={show.image?.medium} alt="" className="h-16 w-11 flex-none rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold">{show.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">{show.genres.slice(0, 3).join(' · ')}</p>
                </div>
                <span className="flex-none rounded-full bg-raised px-2 py-0.5 font-display text-[0.62rem] font-bold text-accent tabular-nums">
                  {Math.min(score.forA, score.forB)}%+ both
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
