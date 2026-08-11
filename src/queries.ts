import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getShowWithEpisodes, getTodaySchedule, getTodayWebSchedule, isoDate, searchShows } from './api/tvmaze'
import {
  fansAlsoWatch,
  getMovie,
  getMovieGenreMap,
  getMovieRecommendations,
  getNowPlaying,
  searchMovies,
} from './api/tmdb'
import { supabase } from './lib/supabase'
import { buildTasteSnapshot, type TasteSnapshot, type TasteSourceMovie } from './lib/match'
import { useLibrary } from './store/library'
import { useMovies } from './store/movies'
import { useProfile, type Top10Show } from './store/profile'
import type { TvmShow } from './types'

const SHOW_STALE_MS = 60 * 60 * 1000 // an hour is plenty for episode metadata

export function useShow(id: number) {
  return useQuery({
    queryKey: ['show', id],
    queryFn: () => getShowWithEpisodes(id),
    staleTime: SHOW_STALE_MS,
    enabled: id > 0,
  })
}

export function useTrackedShowDetails(ids: number[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['show', id],
      queryFn: () => getShowWithEpisodes(id),
      staleTime: SHOW_STALE_MS,
    })),
  })
}

export function useTodaySchedules() {
  return useQueries({
    queries: [
      { queryKey: ['schedule', 'broadcast', isoDate()], queryFn: () => getTodaySchedule(), staleTime: SHOW_STALE_MS },
      { queryKey: ['schedule', 'web', isoDate()], queryFn: () => getTodayWebSchedule(), staleTime: SHOW_STALE_MS },
    ],
  })
}

/**
 * A window of release days (yesterday → +3 days), broadcast + streaming.
 * This is the candidate pool for taste-based recommendations until the
 * backend maintains a proper catalog.
 */
export function useScheduleWindow() {
  const offsets = [-1, 0, 1, 2, 3]
  return useQueries({
    queries: offsets.flatMap((off) => [
      {
        queryKey: ['schedule', 'broadcast', isoDate(off)],
        queryFn: () => getTodaySchedule(isoDate(off)),
        staleTime: SHOW_STALE_MS,
      },
      {
        queryKey: ['schedule', 'web', isoDate(off)],
        queryFn: () => getTodayWebSchedule(isoDate(off)),
        staleTime: SHOW_STALE_MS,
      },
    ]),
  })
}

/** "People who watch <seed> also watch …" via TMDB, mapped to TVmaze shows. */
export function useFansAlsoWatch(seeds: { id: number; name: string; imdb: string | null }[], tmdbKey: string) {
  return useQueries({
    queries: seeds.map((seed) => ({
      queryKey: ['fans-also-watch', seed.id],
      queryFn: async (): Promise<{ seedName: string; shows: TvmShow[] }> => ({
        seedName: seed.name,
        shows: seed.imdb ? await fansAlsoWatch(seed.imdb, tmdbKey) : [],
      }),
      enabled: tmdbKey.length > 0 && !!seed.imdb,
      staleTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  })
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => searchShows(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}

/* ------------------------------- movies -------------------------------- */

export function useMovieSearch(query: string, tmdbKey: string) {
  return useQuery({
    queryKey: ['movie-search', query],
    queryFn: () => searchMovies(query, tmdbKey),
    enabled: tmdbKey.length > 0 && query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}

export function useMovie(id: number, tmdbKey: string) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => getMovie(id, tmdbKey),
    enabled: id > 0 && tmdbKey.length > 0,
    staleTime: SHOW_STALE_MS,
  })
}

export function useMovieRecs(id: number, tmdbKey: string) {
  return useQuery({
    queryKey: ['movie-recs', id],
    queryFn: () => getMovieRecommendations(id, tmdbKey),
    enabled: id > 0 && tmdbKey.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })
}

export function useNowPlaying(tmdbKey: string) {
  return useQuery({
    queryKey: ['movies-now-playing'],
    queryFn: () => getNowPlaying(tmdbKey),
    enabled: tmdbKey.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  })
}

export function useMovieGenreMap(tmdbKey: string) {
  return useQuery({
    queryKey: ['movie-genres'],
    queryFn: () => getMovieGenreMap(tmdbKey),
    enabled: tmdbKey.length > 0,
    staleTime: Infinity,
  })
}

/* --------------------- taste match / MrWatch AI data --------------------- */

/** Bound the TVmaze detail fan-out for genre profiles. */
const TASTE_DETAIL_CAP = 30

export interface FriendData {
  id: string
  username: string
  avatarUrl: string | null
  tracks: { show_id: number; name: string; image: string | null }[]
  watchedCounts: Record<number, number>
  ladderShows: Top10Show[]
  ladderMovies: Top10Show[]
  movies: TasteSourceMovie[]
}

/** Everything needed to model a friend's taste, from Supabase. */
export function useFriendData(username: string, enabled: boolean) {
  return useQuery({
    queryKey: ['friend-data', username.toLowerCase()],
    queryFn: async (): Promise<FriendData | null> => {
      const { data: prof } = await supabase!
        .from('profiles')
        .select('*')
        .ilike('username', username)
        .maybeSingle()
      if (!prof) return null

      const [tracks, watchedRows, movieRows] = await Promise.all([
        supabase!.from('tracks').select('show_id, name, image').eq('user_id', prof.id).order('added_at', { ascending: false }),
        supabase!.from('watched').select('show_id').eq('user_id', prof.id).limit(20000),
        supabase!.from('movie_tracks').select('*').eq('user_id', prof.id),
      ])

      const watchedCounts: Record<number, number> = {}
      for (const row of watchedRows.data ?? []) {
        watchedCounts[row.show_id] = (watchedCounts[row.show_id] ?? 0) + 1
      }

      return {
        id: prof.id,
        username: prof.username,
        avatarUrl: prof.avatar_url ?? null,
        tracks: tracks.data ?? [],
        watchedCounts,
        ladderShows: prof.top10_shows ?? [],
        ladderMovies: prof.top10_movies ?? [],
        // movie_tracks may not exist pre-migration → error → treat as none
        movies: (movieRows.data ?? []).map((m): TasteSourceMovie => ({
          id: m.movie_id,
          title: m.title,
          poster: m.poster,
          genres: m.genres ?? [],
          status: m.status === 'watched' ? 'watched' : 'want',
        })),
      }
    },
    enabled: enabled && !!supabase && username.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}

/** My taste snapshot, assembled from the local stores + TVmaze details. */
export function useMyTasteSnapshot(): { snapshot: TasteSnapshot; ready: boolean } {
  const { shows, watched } = useLibrary()
  const { movies } = useMovies()
  const profile = useProfile()

  const tracked = Object.values(shows)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((s) => ({ id: s.id, name: s.name, image: s.image }))
  const detailQueries = useTrackedShowDetails(tracked.slice(0, TASTE_DETAIL_CAP).map((s) => s.id))
  const ready = detailQueries.every((q) => !q.isLoading)

  const snapshot = useMemo(
    () =>
      buildTasteSnapshot({
        username: profile.username,
        tracked,
        showDetails: detailQueries.map((q) => q.data).filter((d): d is TvmShow => !!d),
        watchedCounts: Object.fromEntries(
          Object.entries(watched).map(([id, eps]) => [id, eps.length]),
        ),
        ladderShows: profile.top10Shows,
        ladderMovies: profile.top10Movies,
        movies: Object.values(movies).map((m) => ({
          id: m.id,
          title: m.title,
          poster: m.poster,
          genres: m.genres,
          status: m.status,
        })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shows, watched, movies, profile, detailQueries.map((q) => q.dataUpdatedAt).join(',')],
  )
  return { snapshot, ready }
}

/** A friend's taste snapshot, from their cloud data + TVmaze details. */
export function useFriendTasteSnapshot(username: string, enabled: boolean) {
  const friend = useFriendData(username, enabled)
  const trackIds = (friend.data?.tracks ?? []).slice(0, TASTE_DETAIL_CAP).map((t) => t.show_id)
  const detailQueries = useTrackedShowDetails(trackIds)
  const ready = !friend.isLoading && detailQueries.every((q) => !q.isLoading)

  const snapshot = useMemo(() => {
    const d = friend.data
    if (!d) return null
    return buildTasteSnapshot({
      username: d.username,
      tracked: d.tracks.map((t) => ({ id: t.show_id, name: t.name, image: t.image })),
      showDetails: detailQueries.map((q) => q.data).filter((det): det is TvmShow => !!det),
      watchedCounts: d.watchedCounts,
      ladderShows: d.ladderShows,
      ladderMovies: d.ladderMovies,
      movies: d.movies,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend.data, detailQueries.map((q) => q.dataUpdatedAt).join(',')])

  return { friend: friend.data ?? null, isLoading: friend.isLoading, snapshot, ready }
}
