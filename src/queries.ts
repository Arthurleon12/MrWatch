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
import { fetchAllPages, type PageResult } from './lib/paginate'
import { showRatings, type ShowRating } from './lib/ratings'
import { useLibrary } from './store/library'
import { useMovies } from './store/movies'
import { useProfile, type Top10Show } from './store/profile'
import { useSettings } from './store/settings'
import { buildProgress, isSpoiler, parseEpCode, type EpisodeRef } from './lib/spoiler'
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

export interface ActivityEvent {
  key: string
  kind: 'watched' | 'tracked' | 'movie'
  username: string
  avatarUrl: string | null
  /** show or movie title */
  title: string
  image: string | null
  showId?: number
  movieId?: number
  /** episodes bundled into this event (kind: watched) */
  count?: number
  /** highest episode rating in the bundle, when any */
  rating?: number
  at: number
}

/**
 * What the people you follow have been up to — check-ins grouped per show
 * so a binge reads as one line, plus new tracks and watched movies.
 */
export function useFriendActivity(uid: string | undefined) {
  return useQuery({
    queryKey: ['friend-activity', uid],
    queryFn: async (): Promise<{ following: number; events: ActivityEvent[] }> => {
      const { data: follows, error: followsError } = await supabase!
        .from('follows')
        .select('followee_id')
        .eq('follower_id', uid!)
      if (followsError) throw new Error(followsError.message)
      const ids = (follows ?? []).map((f) => f.followee_id)
      if (ids.length === 0) return { following: 0, events: [] }

      const [profilesRes, tracksRes, watchedRes, moviesRes] = await Promise.all([
        supabase!.from('profiles').select('id, username, avatar_url').in('id', ids),
        supabase!
          .from('tracks')
          .select('user_id, show_id, name, image, added_at')
          .in('user_id', ids)
          .order('added_at', { ascending: false })
          .limit(30),
        supabase!
          .from('watched')
          .select('user_id, show_id, rating, watched_at')
          .in('user_id', ids)
          .order('watched_at', { ascending: false })
          .limit(300),
        supabase!.from('movie_tracks').select('user_id, movie_id, title, poster, status, watched_at, added_at').in('user_id', ids),
      ])
      if (profilesRes.error) throw new Error(profilesRes.error.message)

      const who = new Map(
        (profilesRes.data ?? []).map((p) => [
          p.id as string,
          { username: p.username as string, avatarUrl: (p.avatar_url as string | null) ?? null },
        ]),
      )
      const showMeta = new Map(
        (tracksRes.data ?? []).map((t) => [`${t.user_id}|${t.show_id}`, { name: t.name, image: t.image }]),
      )

      const events: ActivityEvent[] = []

      // check-ins, one event per (person, show) bundle
      const bundles = new Map<string, ActivityEvent>()
      for (const w of watchedRes.data ?? []) {
        const person = who.get(w.user_id)
        if (!person) continue
        const meta = showMeta.get(`${w.user_id}|${w.show_id}`)
        const bkey = `${w.user_id}|${w.show_id}`
        const existing = bundles.get(bkey)
        const at = w.watched_at ? new Date(w.watched_at).getTime() : 0
        if (existing) {
          existing.count = (existing.count ?? 1) + 1
          existing.at = Math.max(existing.at, at)
          if (w.rating != null) existing.rating = Math.max(existing.rating ?? 0, Number(w.rating))
        } else {
          bundles.set(bkey, {
            key: `w|${bkey}`,
            kind: 'watched',
            username: person.username,
            avatarUrl: person.avatarUrl,
            title: meta?.name ?? 'a show',
            image: meta?.image ?? null,
            showId: w.show_id,
            count: 1,
            rating: w.rating != null ? Number(w.rating) : undefined,
            at,
          })
        }
      }
      events.push(...bundles.values())

      for (const t of tracksRes.data ?? []) {
        const person = who.get(t.user_id)
        if (!person) continue
        events.push({
          key: `t|${t.user_id}|${t.show_id}`,
          kind: 'tracked',
          username: person.username,
          avatarUrl: person.avatarUrl,
          title: t.name,
          image: t.image,
          showId: t.show_id,
          at: new Date(t.added_at).getTime(),
        })
      }

      for (const m of moviesRes.data ?? []) {
        if (m.status !== 'watched') continue
        const person = who.get(m.user_id)
        if (!person) continue
        events.push({
          key: `m|${m.user_id}|${m.movie_id}`,
          kind: 'movie',
          username: person.username,
          avatarUrl: person.avatarUrl,
          title: m.title,
          image: m.poster,
          movieId: m.movie_id,
          at: new Date(m.watched_at ?? m.added_at).getTime(),
        })
      }

      events.sort((a, b) => b.at - a.at)
      return { following: ids.length, events: events.slice(0, 20) }
    },
    enabled: !!supabase && !!uid,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export interface MyArticleRow {
  id: string
  title: string
  subject: { showName?: string; epCode?: string }
  createdAt: number
}

/**
 * Your posts as the DATABASE has them — the proof they're really stored,
 * not just sitting in this browser's localStorage.
 */
export function useMyArticles(uid: string | undefined) {
  return useQuery({
    queryKey: ['my-articles', uid],
    queryFn: async (): Promise<MyArticleRow[]> => {
      const { data, error } = await supabase!
        .from('articles')
        .select('id, title, subject, created_at')
        .eq('user_id', uid!)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        subject: a.subject ?? {},
        createdAt: new Date(a.created_at).getTime(),
      }))
    },
    enabled: !!supabase && !!uid,
    staleTime: 30 * 1000,
  })
}

/* ------------------------------ spoiler guard ----------------------------- */

/**
 * Spoiler guard for the shows on screen. Pass the show ids a page renders;
 * only tracked ones are gated, and their episode metadata is the same cache
 * entry those pages already read, so this costs no extra requests.
 */
export function useSpoilerGuard(showIds: number[]) {
  const { shows, watched } = useLibrary()
  const { spoilerGuard } = useSettings()

  const key = showIds.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => [...new Set(showIds)].filter((id) => id in shows), [key, shows])
  const details = useTrackedShowDetails(spoilerGuard ? ids : [])

  const progress = useMemo(
    () => buildProgress(details.map((q) => q.data).filter((d): d is TvmShow => !!d), watched),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [details.map((q) => q.dataUpdatedAt).join(','), watched],
  )

  return useMemo(
    () => ({
      enabled: spoilerGuard,
      /** Should this episode's title stay hidden? Accepts a ref or an "S05E10" code. */
      hides(showId: number, episode: EpisodeRef | string | null | undefined): boolean {
        if (!spoilerGuard) return false
        const ref = typeof episode === 'string' ? parseEpCode(episode) : (episode ?? null)
        return isSpoiler(ref, progress.get(showId))
      },
    }),
    [spoilerGuard, progress],
  )
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
  /** show id → their episode-rating average, for taste comparison */
  showRatings: Record<number, ShowRating>
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

      const [tracks, movieRows] = await Promise.all([
        supabase!.from('tracks').select('show_id, name, image').eq('user_id', prof.id).order('added_at', { ascending: false }),
        supabase!.from('movie_tracks').select('*').eq('user_id', prof.id),
      ])
      // a failed fetch must error (and retry), not get cached as "no data";
      // movie_tracks is the exception — it may not exist pre-migration
      if (tracks.error) throw new Error(tracks.error.message)

      // PostgREST caps responses at ~1000 rows — page through the history
      type WatchedRow = { show_id: number; rating: number | null }
      const readWatched = (columns: string) =>
        fetchAllPages<WatchedRow>(
          (from, to) =>
            supabase!
              .from('watched')
              .select(columns)
              .eq('user_id', prof.id)
              .order('episode_id', { ascending: true })
              .range(from, to) as unknown as Promise<PageResult<WatchedRow>>,
        )
      let watchedRes = await readWatched('show_id, rating')
      // a database that predates the ratings migration still has to load
      if (watchedRes.error && /rating/i.test(watchedRes.error.message)) {
        watchedRes = await readWatched('show_id')
      }
      if (watchedRes.error) throw new Error(watchedRes.error.message)

      const watchedCounts: Record<number, number> = {}
      const ratingTotals = new Map<number, { sum: number; count: number }>()
      for (const row of watchedRes.rows) {
        watchedCounts[row.show_id] = (watchedCounts[row.show_id] ?? 0) + 1
        if (row.rating != null) {
          const acc = ratingTotals.get(row.show_id) ?? { sum: 0, count: 0 }
          acc.sum += Number(row.rating)
          acc.count++
          ratingTotals.set(row.show_id, acc)
        }
      }
      const friendRatings: Record<number, ShowRating> = {}
      for (const [showId, acc] of ratingTotals) {
        friendRatings[showId] = { avg: acc.sum / acc.count, count: acc.count }
      }

      return {
        id: prof.id,
        username: prof.username,
        avatarUrl: prof.avatar_url ?? null,
        tracks: tracks.data ?? [],
        watchedCounts,
        showRatings: friendRatings,
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
  const { shows, watched, ratings } = useLibrary()
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
        showRatings: showRatings(watched, ratings),
        movies: Object.values(movies).map((m) => ({
          id: m.id,
          title: m.title,
          poster: m.poster,
          genres: m.genres,
          status: m.status,
        })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shows, watched, ratings, movies, profile, detailQueries.map((q) => q.dataUpdatedAt).join(',')],
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
      showRatings: new Map(Object.entries(d.showRatings).map(([id, r]) => [Number(id), r])),
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
