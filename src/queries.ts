import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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

/* ------------------------- social: likes + bells ------------------------- */

export interface LikeRow {
  article_id: string
  user_id: string
  username: string
}

/** All likes for a set of articles in one query — cards derive count + mine. */
export function useArticleLikes(articleIds: string[], enabled: boolean) {
  const key = [...articleIds].sort().join(',')
  return useQuery({
    queryKey: ['likes', key],
    queryFn: async (): Promise<LikeRow[]> => {
      const { data, error } = await supabase!
        .from('likes')
        .select('article_id, user_id, profiles!likes_user_id_fkey(username)')
        .in('article_id', articleIds)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => ({
        article_id: r.article_id,
        user_id: r.user_id,
        username: (r.profiles as unknown as { username: string })?.username ?? 'someone',
      }))
    },
    enabled: enabled && !!supabase && articleIds.length > 0,
    staleTime: 30 * 1000,
  })
}

export function useLikeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ articleId, like, uid }: { articleId: string; like: boolean; uid: string }) => {
      if (like) {
        const { error } = await supabase!.from('likes').insert({ user_id: uid, article_id: articleId })
        // double-tap race: the row already existing is a success, not a failure
        if (error && error.code !== '23505') throw new Error(error.message)
      } else {
        const { error } = await supabase!
          .from('likes')
          .delete()
          .eq('user_id', uid)
          .eq('article_id', articleId)
        if (error) throw new Error(error.message)
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['likes'] }),
  })
}

export interface NotificationRow {
  id: string
  type: 'follow' | 'like'
  payload: { articleId?: string; title?: string }
  read: boolean
  createdAt: number
  actor: { username: string; avatarUrl: string | null }
}

export function useNotifications(uid: string | undefined) {
  return useQuery({
    queryKey: ['notifications', uid],
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase!
        .from('notifications')
        .select('id, type, payload, read, created_at, profiles!notifications_actor_id_fkey(username, avatar_url)')
        .eq('recipient_id', uid!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []).map((n) => {
        const actor = n.profiles as unknown as { username: string; avatar_url: string | null } | null
        return {
          id: n.id,
          type: n.type as 'follow' | 'like',
          payload: n.payload ?? {},
          read: n.read,
          createdAt: new Date(n.created_at).getTime(),
          actor: { username: actor?.username ?? 'someone', avatarUrl: actor?.avatar_url ?? null },
        }
      })
    },
    enabled: !!supabase && !!uid,
    staleTime: 30 * 1000,
  })
}

export function useUnreadCount(uid: string | undefined) {
  return useQuery({
    queryKey: ['notif-unread', uid],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase!
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', uid!)
        .eq('read', false)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    enabled: !!supabase && !!uid,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

export interface ConnectionRow {
  username: string
  avatarUrl: string | null
  bio: string
}

/** Who follows @username, or who they follow. */
export function useConnections(username: string, kind: 'followers' | 'following', enabled: boolean) {
  return useQuery({
    queryKey: ['connections', username.toLowerCase(), kind],
    queryFn: async (): Promise<{ owner: string; people: ConnectionRow[] } | null> => {
      const { data: prof, error: profError } = await supabase!
        .from('profiles')
        .select('id, username')
        .eq('username', username)
        .maybeSingle()
      if (profError) throw new Error(profError.message)
      if (!prof) return null

      const query =
        kind === 'followers'
          ? supabase!
              .from('follows')
              .select('person:profiles!follows_follower_id_fkey(username, avatar_url, bio)')
              .eq('followee_id', prof.id)
          : supabase!
              .from('follows')
              .select('person:profiles!follows_followee_id_fkey(username, avatar_url, bio)')
              .eq('follower_id', prof.id)
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return {
        owner: prof.username,
        people: (data ?? []).map((r) => {
          const p = r.person as unknown as { username: string; avatar_url: string | null; bio: string }
          return { username: p.username, avatarUrl: p.avatar_url, bio: p.bio ?? '' }
        }),
      }
    },
    enabled: enabled && !!supabase && username.length > 0,
    staleTime: 60 * 1000,
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
      // username is citext, so eq is case-insensitive — and unlike ilike it
      // treats underscores literally instead of as single-char wildcards
      const { data: prof, error: profError } = await supabase!
        .from('profiles')
        .select('*')
        .eq('username', username)
        .maybeSingle()
      if (profError) throw new Error(profError.message)
      if (!prof) return null

      const [tracks, watchedRows, movieRows] = await Promise.all([
        supabase!.from('tracks').select('show_id, name, image').eq('user_id', prof.id).order('added_at', { ascending: false }),
        supabase!.from('watched').select('show_id').eq('user_id', prof.id).limit(20000),
        supabase!.from('movie_tracks').select('*').eq('user_id', prof.id),
      ])
      // a failed fetch must error (and retry), not get cached as "no data";
      // movie_tracks is the exception — it may not exist pre-migration
      if (tracks.error) throw new Error(tracks.error.message)
      if (watchedRows.error) throw new Error(watchedRows.error.message)

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

  return {
    friend: friend.data ?? null,
    isLoading: friend.isLoading,
    isError: friend.isError,
    refetch: friend.refetch,
    snapshot,
    ready,
  }
}
