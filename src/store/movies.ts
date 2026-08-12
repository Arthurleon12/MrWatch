import { useSyncExternalStore } from 'react'
import { emitStoreChange } from '../lib/bus'
import { getProfileState, setTop10Movies } from './profile'
import { tmdbImage, type TmdbMovie, type TmdbMovieDetails } from '../api/tmdb'

/**
 * Movie library — same local-first pattern as the show library. Movies are
 * TMDB ids (shows are TVmaze ids); the two id spaces never mix. Genres are
 * kept on each entry so taste matching works without refetching.
 */

export type MovieStatus = 'want' | 'watched'

export interface TrackedMovie {
  id: number
  title: string
  year: string | null
  poster: string | null // full image URL
  genres: string[]
  runtime: number | null
  status: MovieStatus
  addedAt: number
  watchedAt: number | null
}

interface MoviesState {
  movies: Record<number, TrackedMovie>
}

const STORAGE_KEY = 'mrwatch:movies:v1'

function load(): MoviesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as MoviesState
  } catch {
    // corrupted state — start fresh rather than crash
  }
  return { movies: {} }
}

let state: MoviesState = load()
const listeners = new Set<() => void>()
let hydrating = false

function commit(next: MoviesState) {
  state = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((l) => l())
  if (!hydrating) emitStoreChange('movies')
}

export function getMoviesState(): MoviesState {
  return state
}

/** Replace local state with the cloud copy — never triggers a push. */
export function hydrateMovies(next: MoviesState) {
  hydrating = true
  commit(next)
  hydrating = false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMovies(): MoviesState {
  return useSyncExternalStore(subscribe, () => state)
}

function toTrackedMovie(
  m: TmdbMovie | TmdbMovieDetails,
  status: MovieStatus,
  genreNames?: string[],
): TrackedMovie {
  const details = m as Partial<TmdbMovieDetails>
  return {
    id: m.id,
    title: m.title,
    year: m.release_date?.slice(0, 4) ?? null,
    poster: tmdbImage(m.poster_path),
    genres: genreNames ?? details.genres?.map((g) => g.name) ?? [],
    runtime: details.runtime ?? null,
    status,
    addedAt: Date.now(),
    watchedAt: status === 'watched' ? Date.now() : null,
  }
}

/** The Top 10 ladder must only hold watched movies — keep it in lockstep. */
function dropFromLadder(id: number) {
  const { top10Movies } = getProfileState()
  if (top10Movies.some((m) => m.id === id)) {
    setTop10Movies(top10Movies.filter((m) => m.id !== id))
  }
}

/**
 * Add or update a movie. Search results carry less metadata than the details
 * call, so an update keeps the richer fields it already has. `genreNames`
 * lets list-endpoint callers supply genres resolved from genre_ids.
 */
export function saveMovie(
  m: TmdbMovie | TmdbMovieDetails,
  status: MovieStatus,
  genreNames?: string[],
) {
  const fresh = toTrackedMovie(m, status, genreNames)
  const existing = state.movies[m.id]
  const entry: TrackedMovie = existing
    ? {
        ...fresh,
        addedAt: existing.addedAt,
        genres: fresh.genres.length > 0 ? fresh.genres : existing.genres,
        runtime: fresh.runtime ?? existing.runtime,
        watchedAt: status === 'watched' ? (existing.watchedAt ?? Date.now()) : null,
      }
    : fresh
  if (status !== 'watched') dropFromLadder(m.id)
  commit({ movies: { ...state.movies, [m.id]: entry } })
}

export function removeMovie(id: number) {
  const movies = { ...state.movies }
  delete movies[id]
  dropFromLadder(id)
  commit({ movies })
}
