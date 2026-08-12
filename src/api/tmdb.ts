/**
 * TMDB integration, two jobs:
 *  1. The collaborative-filtering signal for TV ("people who watch this also
 *     watch…") — every result is mapped back to a TVmaze show via IMDb ids so
 *     the TV side of the app keeps one id space.
 *  2. The movie catalog: search, details, recommendations, now-playing.
 *     Movies live natively in TMDB id space; they never cross into TVmaze.
 */

import type { TvmShow } from '../types'

const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

/** Full CDN URL for a TMDB image path, or null when there is none. */
export function tmdbImage(
  path: string | null | undefined,
  size: 'w154' | 'w342' | 'w500' = 'w342',
): string | null {
  return path ? `${IMG}/${size}${path}` : null
}

async function tmdbGet<T>(path: string, key: string): Promise<T> {
  // TMDB hands out two credential styles; accept whichever the user pasted:
  // the short v3 "API Key" goes in the query string, the long v4
  // "API Read Access Token" (a JWT, always starts with "eyJ") is a Bearer.
  const isBearer = key.startsWith('eyJ')
  const sep = path.includes('?') ? '&' : '?'
  const url = isBearer ? `${BASE}${path}` : `${BASE}${path}${sep}api_key=${encodeURIComponent(key)}`
  const res = await fetch(url, isBearer ? { headers: { Authorization: `Bearer ${key}` } } : undefined)
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

interface TmdbFindResult {
  tv_results: { id: number }[]
}
interface TmdbRecsResult {
  results: { id: number; name: string; vote_average: number }[]
}
interface TmdbExternalIds {
  imdb_id: string | null
}

/* ------------------------------- movies -------------------------------- */

export interface TmdbMovie {
  id: number
  title: string
  release_date?: string | null
  poster_path: string | null
  overview: string
  vote_average: number
  vote_count?: number
  popularity?: number
  genre_ids?: number[]
  original_language?: string
}

export interface TmdbMovieDetails extends TmdbMovie {
  runtime: number | null
  tagline?: string
  genres: { id: number; name: string }[]
  credits?: {
    cast: { name: string; order: number }[]
    crew: { name: string; job: string }[]
  }
}

interface TmdbMovieList {
  results: TmdbMovie[]
}

export async function searchMovies(query: string, key: string): Promise<TmdbMovie[]> {
  const list = await tmdbGet<TmdbMovieList>(
    `/search/movie?query=${encodeURIComponent(query)}&include_adult=false`,
    key,
  )
  return list.results.slice(0, 12)
}

export async function getMovie(id: number, key: string): Promise<TmdbMovieDetails> {
  return tmdbGet<TmdbMovieDetails>(`/movie/${id}?append_to_response=credits`, key)
}

export async function getMovieRecommendations(id: number, key: string, limit = 12): Promise<TmdbMovie[]> {
  const list = await tmdbGet<TmdbMovieList>(`/movie/${id}/recommendations`, key)
  return list.results.filter((m) => m.poster_path).slice(0, limit)
}

export async function getNowPlaying(key: string, limit = 12): Promise<TmdbMovie[]> {
  const list = await tmdbGet<TmdbMovieList>('/movie/now_playing?region=US', key)
  return list.results.filter((m) => m.poster_path).slice(0, limit)
}

/** Numeric genre_ids → names, needed to score list results by taste. */
export async function getMovieGenreMap(key: string): Promise<Map<number, string>> {
  const res = await tmdbGet<{ genres: { id: number; name: string }[] }>('/genre/movie/list', key)
  return new Map(res.genres.map((g) => [g.id, g.name]))
}

/* ----------------------------- TV crossover ----------------------------- */

/** Validate a key with the cheapest authenticated call. */
export async function tmdbKeyWorks(key: string): Promise<boolean> {
  try {
    await tmdbGet('/configuration', key)
    return true
  } catch {
    return false
  }
}

/**
 * Given a seed show's IMDb id, return the TVmaze shows that TMDB users who
 * watch the seed also watch. Pipeline: find TMDB id → recommendations →
 * external ids → TVmaze lookup. Failures on individual hops are dropped.
 */
export async function fansAlsoWatch(imdbId: string, key: string, limit = 6): Promise<TvmShow[]> {
  const found = await tmdbGet<TmdbFindResult>(`/find/${imdbId}?external_source=imdb_id`, key)
  const tmdbId = found.tv_results[0]?.id
  if (!tmdbId) return []

  const recs = await tmdbGet<TmdbRecsResult>(`/tv/${tmdbId}/recommendations`, key)
  const top = recs.results.slice(0, limit * 2) // over-fetch; some won't map to TVmaze

  const shows = await Promise.all(
    top.map(async (rec) => {
      try {
        const ext = await tmdbGet<TmdbExternalIds>(`/tv/${rec.id}/external_ids`, key)
        if (!ext.imdb_id) return null
        const res = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${ext.imdb_id}`)
        if (!res.ok) return null
        return (await res.json()) as TvmShow
      } catch {
        return null
      }
    }),
  )
  return shows.filter((s): s is TvmShow => s !== null).slice(0, limit)
}
