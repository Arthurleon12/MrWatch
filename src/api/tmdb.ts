/**
 * TMDB integration — the collaborative-filtering signal ("people who watch
 * this also watch…") until MrWatch has its own user base. Every result is
 * mapped back to a TVmaze show via IMDb ids so the rest of the app keeps
 * one id space.
 */

import type { TvmShow } from '../types'

const BASE = 'https://api.themoviedb.org/3'

async function tmdbGet<T>(path: string, key: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}${path}${sep}api_key=${encodeURIComponent(key)}`)
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
