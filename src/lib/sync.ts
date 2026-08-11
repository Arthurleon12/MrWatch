import { supabase } from './supabase'
import { onStoreChange, type StoreName } from './bus'
import { getLibraryState, hydrateLibrary } from '../store/library'
import { getMoviesState, hydrateMovies, type MovieStatus, type TrackedMovie } from '../store/movies'
import { getProfileState, hydrateProfile } from '../store/profile'
import { getArticlesState, hydrateArticles, type Article } from '../store/articles'
import { getSession } from '../store/session'
import type { TrackedShow } from '../types'

/**
 * Write-through sync. Local stores stay the source of truth for the UI
 * (instant, offline-friendly); every mutation is debounced and pushed to
 * Supabase. On sign-in the cloud copy is pulled and hydrated; if the cloud
 * is empty but the device has data (pre-account usage), the local data
 * seeds the account — nobody loses their watch history by signing up.
 */

const DEBOUNCE_MS = 1500
const timers = new Map<StoreName, ReturnType<typeof setTimeout>>()
let unsubscribe: (() => void) | null = null

export function startSync() {
  if (unsubscribe || !supabase) return
  unsubscribe = onStoreChange((store) => {
    clearTimeout(timers.get(store))
    timers.set(
      store,
      setTimeout(() => {
        void push(store)
      }, DEBOUNCE_MS),
    )
  })
}

export function stopSync() {
  unsubscribe?.()
  unsubscribe = null
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
}

async function push(store: StoreName) {
  const session = getSession()
  if (!supabase || !session) return
  try {
    if (store === 'library') await pushLibrary(session.user.id)
    if (store === 'movies') await pushMovies(session.user.id)
    if (store === 'profile') await pushProfile(session.user.id)
    if (store === 'articles') await pushArticles(session.user.id)
  } catch (err) {
    // transient network failures self-heal on the next mutation; log for dev
    console.warn(`[sync] push ${store} failed`, err)
  }
}

async function pushLibrary(uid: string) {
  if (!supabase) return
  const { shows, watched } = getLibraryState()
  const trackRows = Object.values(shows).map((s) => ({
    user_id: uid,
    show_id: s.id,
    name: s.name,
    image: s.image,
    status: s.status,
    network: s.network,
    premiered: s.premiered,
    added_at: new Date(s.addedAt).toISOString(),
  }))
  const watchedRows = Object.entries(watched).flatMap(([showId, eps]) =>
    eps.map((episodeId) => ({ user_id: uid, show_id: Number(showId), episode_id: episodeId })),
  )
  await supabase.from('tracks').delete().eq('user_id', uid)
  if (trackRows.length) await supabase.from('tracks').insert(trackRows)
  await supabase.from('watched').delete().eq('user_id', uid)
  if (watchedRows.length) await supabase.from('watched').insert(watchedRows)
}

// The movies migration (supabase/migrations) may not have run yet on an
// existing database. Sync must keep working for everything else, so movie
// pushes fail soft and the profile push retries without the new column.
let warnedMoviesMigration = false
function missingMoviesSchema(message: string | undefined): boolean {
  if (!message || !/movie_tracks|top10_movies/i.test(message)) return false
  if (!warnedMoviesMigration) {
    warnedMoviesMigration = true
    console.warn('[sync] movies not syncing — run supabase/migrations/2026-08-11-movies.sql')
  }
  return true
}

async function pushMovies(uid: string) {
  if (!supabase) return
  const { movies } = getMoviesState()
  const rows = Object.values(movies).map((m) => ({
    user_id: uid,
    movie_id: m.id,
    title: m.title,
    year: m.year,
    poster: m.poster,
    genres: m.genres,
    runtime: m.runtime,
    status: m.status,
    added_at: new Date(m.addedAt).toISOString(),
    watched_at: m.watchedAt ? new Date(m.watchedAt).toISOString() : null,
  }))
  const del = await supabase.from('movie_tracks').delete().eq('user_id', uid)
  if (del.error) {
    if (!missingMoviesSchema(del.error.message)) throw new Error(del.error.message)
    return
  }
  if (rows.length) {
    const ins = await supabase.from('movie_tracks').insert(rows)
    if (ins.error) throw new Error(ins.error.message)
  }
}

async function pushProfile(uid: string) {
  if (!supabase) return
  const p = getProfileState()
  const payload = {
    id: uid,
    username: p.username,
    bio: p.bio,
    avatar_url: p.avatar,
    top10_shows: p.top10Shows,
    top10_episodes: p.top10Episodes,
    top10_movies: p.top10Movies,
  }
  const { error } = await supabase.from('profiles').upsert(payload)
  if (error && missingMoviesSchema(error.message)) {
    const { top10_movies: _omitted, ...legacy } = payload
    await supabase.from('profiles').upsert(legacy)
  }
}

async function pushArticles(uid: string) {
  if (!supabase) return
  const local = getArticlesState()
  const { data: remote } = await supabase.from('articles').select('id').eq('user_id', uid)
  const localIds = new Set(local.map((a) => a.id))
  const stale = (remote ?? []).filter((r) => !localIds.has(r.id)).map((r) => r.id)
  if (stale.length) await supabase.from('articles').delete().in('id', stale)
  if (local.length) {
    await supabase.from('articles').upsert(
      local.map((a) => ({
        id: a.id,
        user_id: uid,
        title: a.title,
        body: a.body,
        subject: a.subject,
        created_at: new Date(a.createdAt).toISOString(),
      })),
    )
  }
}

/** On sign-in: cloud wins when it has data; otherwise local seeds the cloud. */
export async function pullAndHydrate(uid: string) {
  if (!supabase) return
  const [profileRes, tracksRes, watchedRes, moviesRes, articlesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('tracks').select('*').eq('user_id', uid),
    supabase.from('watched').select('show_id, episode_id').eq('user_id', uid),
    supabase.from('movie_tracks').select('*').eq('user_id', uid),
    supabase.from('articles').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
  ])

  const prof = profileRes.data
  if (prof) {
    hydrateProfile({
      username: prof.username,
      bio: prof.bio ?? '',
      avatar: prof.avatar_url ?? null,
      top10Shows: prof.top10_shows ?? [],
      top10Episodes: prof.top10_episodes ?? [],
      top10Movies: prof.top10_movies ?? [],
      following: [],
      followers: [],
    })
  }

  const tracks = tracksRes.data ?? []
  if (tracks.length > 0) {
    const shows: Record<number, TrackedShow> = {}
    for (const t of tracks) {
      shows[t.show_id] = {
        id: t.show_id,
        name: t.name,
        image: t.image,
        status: t.status ?? '',
        network: t.network,
        premiered: t.premiered,
        addedAt: new Date(t.added_at).getTime(),
      }
    }
    const watched: Record<number, number[]> = {}
    for (const w of watchedRes.data ?? []) {
      ;(watched[w.show_id] ??= []).push(w.episode_id)
    }
    hydrateLibrary({ shows, watched })
  } else if (Object.keys(getLibraryState().shows).length > 0) {
    await pushLibrary(uid) // first login on a device with history: migrate it up
  }

  if (moviesRes.error) {
    missingMoviesSchema(moviesRes.error.message)
  } else if ((moviesRes.data ?? []).length > 0) {
    const movies: Record<number, TrackedMovie> = {}
    for (const m of moviesRes.data!) {
      movies[m.movie_id] = {
        id: m.movie_id,
        title: m.title,
        year: m.year,
        poster: m.poster,
        genres: m.genres ?? [],
        runtime: m.runtime,
        status: (m.status as MovieStatus) ?? 'want',
        addedAt: new Date(m.added_at).getTime(),
        watchedAt: m.watched_at ? new Date(m.watched_at).getTime() : null,
      }
    }
    hydrateMovies({ movies })
  } else if (Object.keys(getMoviesState().movies).length > 0) {
    await pushMovies(uid)
  }

  const remoteArticles = articlesRes.data ?? []
  if (remoteArticles.length > 0) {
    hydrateArticles(
      remoteArticles.map(
        (a): Article => ({
          id: a.id,
          title: a.title,
          body: a.body,
          subject: a.subject,
          author: prof?.username ?? getProfileState().username,
          createdAt: new Date(a.created_at).getTime(),
        }),
      ),
    )
  } else if (getArticlesState().length > 0) {
    await pushArticles(uid)
  }
}
