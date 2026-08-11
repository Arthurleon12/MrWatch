import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMovie, useMovieRecs } from '../queries'
import { removeMovie, saveMovie, useMovies } from '../store/movies'
import { useProfile } from '../store/profile'
import { useTmdbKey } from '../store/settings'
import { tmdbImage } from '../api/tmdb'
import { Poster } from '../components/Poster'
import { BookmarkIcon, CheckIcon, ChevronLeftIcon } from '../components/icons'

function runtimeLabel(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function MoviePage() {
  const { id } = useParams()
  const movieId = Number(id)
  const navigate = useNavigate()
  const tmdbKey = useTmdbKey()
  const { data: movie, isLoading, isError } = useMovie(movieId, tmdbKey)
  const { data: recs } = useMovieRecs(movieId, tmdbKey)
  const { movies } = useMovies()
  const [expandOverview, setExpandOverview] = useState(false)

  const saved = movies[movieId]
  const isWatched = saved?.status === 'watched'
  const isWanted = saved?.status === 'want'
  const ladderPos = useProfile().top10Movies.findIndex((m) => m.id === movieId)

  if (!tmdbKey) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">
          Movies need the TMDB catalog. Connect a free TMDB API key and this page comes alive.
        </p>
        <Link to="/profile" className="mt-3 inline-block text-sm font-bold text-accent">
          Connect in Profile →
        </Link>
      </div>
    )
  }
  if (isLoading) {
    return <div className="px-4 pt-6"><div className="h-48 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (isError || !movie) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">Couldn't load this movie. Check your connection and try again.</p>
        <Link to="/search" className="mt-3 inline-block text-sm text-accent">Back to Search</Link>
      </div>
    )
  }

  const year = movie.release_date?.slice(0, 4)
  const runtime = runtimeLabel(movie.runtime)
  const rating = movie.vote_average ? `★ ${movie.vote_average.toFixed(1)}` : null
  const director = movie.credits?.crew.find((c) => c.job === 'Director')?.name
  const cast = (movie.credits?.cast ?? []).slice(0, 3).map((c) => c.name)

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
          <Poster src={tmdbImage(movie.poster_path)} alt="" kind="movie" className="h-36 w-24 flex-none rounded-xl" />
          <div className="min-w-0 pt-1">
            <h1 className="font-display text-xl font-bold leading-tight">{movie.title}</h1>
            <p className="mt-1 text-xs text-ink-soft">
              {['Movie', year, runtime, rating].filter(Boolean).join(' · ')}
            </p>
            {movie.genres.length > 0 && (
              <p className="mt-1 text-xs text-ink-faint">{movie.genres.map((g) => g.name).join(' · ')}</p>
            )}
            {(director || cast.length > 0) && (
              <p className="mt-1 text-xs text-ink-faint">
                {[director ? `Dir. ${director}` : null, cast.length ? cast.join(', ') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!isWatched && (
            <button
              onClick={() => (isWanted ? removeMovie(movie.id) : saveMovie(movie, 'want'))}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-xs font-bold transition-colors ${
                isWanted ? 'bg-surface text-ink-soft' : 'bg-accent text-bg'
              }`}
            >
              {isWanted ? <CheckIcon className="h-3.5 w-3.5" /> : <BookmarkIcon className="h-3.5 w-3.5" />}
              {isWanted ? 'On your list' : 'Want to watch'}
            </button>
          )}
          <button
            onClick={() => (isWatched ? saveMovie(movie, 'want') : saveMovie(movie, 'watched'))}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-xs font-bold transition-colors ${
              isWatched ? 'bg-surface text-ink-soft' : isWanted ? 'bg-accent text-bg' : 'border-2 border-line bg-transparent py-1.5 text-ink-soft'
            }`}
          >
            <CheckIcon className="h-3.5 w-3.5" />
            {isWatched ? 'Watched' : 'Mark watched'}
          </button>
          {isWatched && (
            <Link
              to={`/rank/movie/${movie.id}`}
              className="rounded-full border-2 border-accent px-4 py-1.5 font-display text-xs font-bold text-accent"
            >
              {ladderPos >= 0 ? `Ranked #${ladderPos + 1} · re-rank` : 'Rank it'}
            </Link>
          )}
        </div>

        {movie.overview && (
          <p
            onClick={() => setExpandOverview((v) => !v)}
            className={`mt-4 text-sm leading-relaxed text-ink-soft ${expandOverview ? '' : 'line-clamp-3'}`}
          >
            {movie.overview}
          </p>
        )}
      </div>

      {(recs?.length ?? 0) > 0 && (
        <section className="mt-8 px-4 pb-2">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            Fans of this also watch
          </h2>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {recs!.map((rec) => (
              <Link key={rec.id} to={`/movie/${rec.id}`} className="w-24 flex-none">
                <Poster src={tmdbImage(rec.poster_path, 'w154')} alt="" kind="movie" className="h-34 w-24 rounded-lg" />
                <p className="mt-1 truncate text-[0.68rem] text-ink-soft">{rec.title}</p>
                {rec.vote_average > 0 && (
                  <p className="text-[0.62rem] text-ink-faint">★ {rec.vote_average.toFixed(1)}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
