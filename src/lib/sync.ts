import { supabase } from './supabase'
import { fetchAllPages, type PageResult } from './paginate'
import { reportError } from './report'
import { onStoreChange, type StoreName } from './bus'
import {
  chunk,
  diffAgainstBaseline,
  mergeWithCloud,
  signatures,
  type Baseline,
} from './syncDiff'
import { getLibraryState, hydrateLibrary, type LibraryState } from '../store/library'
import { getMoviesState, hydrateMovies, type MovieStatus, type TrackedMovie } from '../store/movies'
import { getProfileState, hydrateProfile, resetProfile } from '../store/profile'
import { getArticlesState, hydrateArticles, type Article } from '../store/articles'
import { getSession } from '../store/session'
import type { TrackedShow } from '../types'

/**
 * Write-through sync. Local stores stay the source of truth for the UI
 * (instant, usable offline); every mutation is debounced and pushed to
 * Supabase, and the cloud copy is pulled on sign-in and when the app comes
 * back to the foreground.
 *
 * The rules that keep a watch history safe — each one is here because its
 * absence either lost data or could have:
 *
 *  1. A push never deletes by "everything not in my local copy". It sends a
 *     diff against the *baseline* (what this device last saw in the cloud), so
 *     a row this device has never seen cannot be deleted by it.
 *  2. No baseline, no push. The baseline only exists after a pull of that
 *     table succeeded in this session, so a failed or partial pull can never
 *     be followed by a destructive push.
 *  3. A local edit is marked dirty on disk the moment it happens and stays
 *     dirty until a push carrying it succeeds. A pull merges into dirty
 *     stores instead of overwriting them, so closing the app mid-debounce,
 *     going offline, or a failed push never erases what the user just did.
 *  4. On-device data has an owner. Another account signing in on the same
 *     device never inherits or uploads it.
 *  5. Pulls and pushes run strictly one at a time.
 */

const DEBOUNCE_MS = 1500
const REPULL_AFTER_MS = 5 * 60 * 1000
const UPSERT_CHUNK = 500
const DELETE_CHUNK = 200

const OWNER_KEY = 'mrwatch:owner'
const DIRTY_KEY = 'mrwatch:dirty:v1'
const ALL_STORES: StoreName[] = ['library', 'movies', 'profile', 'articles']

// ---------------------------------------------------------------------------
// durable markers (owner + dirty stores)

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable — sync still works for this page load
  }
}

function readDirty(uid: string): Set<StoreName> {
  try {
    const parsed = JSON.parse(lsGet(DIRTY_KEY) ?? 'null') as { uid: string; stores: StoreName[] } | null
    if (parsed && parsed.uid === uid && Array.isArray(parsed.stores)) return new Set(parsed.stores)
  } catch {
    // unreadable marker — treated as clean
  }
  return new Set()
}

function writeDirty(uid: string, stores: Set<StoreName>) {
  lsSet(DIRTY_KEY, stores.size ? JSON.stringify({ uid, stores: [...stores] }) : null)
}

function markDirty(uid: string, store: StoreName) {
  const dirty = readDirty(uid)
  if (dirty.has(store)) return
  dirty.add(store)
  writeDirty(uid, dirty)
}

function clearDirty(uid: string, store: StoreName) {
  const dirty = readDirty(uid)
  if (dirty.delete(store)) writeDirty(uid, dirty)
}

// ---------------------------------------------------------------------------
// what this device last saw in the cloud (in memory, per signed-in user)

interface CloudView {
  uid: string
  tracks?: Baseline<number>
  watched?: Baseline<number>
  movies?: Baseline<number>
  articles?: Baseline<string>
  profile?: boolean
}

let view: CloudView | null = null

function viewFor(uid: string): CloudView {
  if (!view || view.uid !== uid) view = { uid }
  return view
}

function canPush(store: StoreName, uid: string): boolean {
  if (!view || view.uid !== uid) return false
  if (store === 'library') return !!view.tracks && !!view.watched
  if (store === 'movies') return !!view.movies
  if (store === 'articles') return !!view.articles
  return !!view.profile
}

// ---------------------------------------------------------------------------
// local state as keyed rows

interface WatchedEntry {
  showId: number
  episodeId: number
  rating: number | null
}

const trackSig = () => ''
const watchedSig = (w: WatchedEntry) => (w.rating === null ? '' : String(w.rating))
const movieSig = (m: TrackedMovie) => `${m.status}|${m.watchedAt ?? ''}`
const articleSig = () => ''

function localTracks(state: LibraryState): Map<number, TrackedShow> {
  return new Map(Object.values(state.shows).map((s) => [s.id, s]))
}

function localWatched(state: LibraryState): Map<number, WatchedEntry> {
  const out = new Map<number, WatchedEntry>()
  for (const [showId, eps] of Object.entries(state.watched)) {
    for (const episodeId of eps) {
      out.set(episodeId, { showId: Number(showId), episodeId, rating: state.ratings[episodeId] ?? null })
    }
  }
  return out
}

function toLibraryState(tracks: Map<number, TrackedShow>, watchedRows: Map<number, WatchedEntry>): LibraryState {
  const shows: Record<number, TrackedShow> = {}
  for (const [id, s] of tracks) shows[id] = s
  const watched: Record<number, number[]> = {}
  const ratings: Record<number, number> = {}
  for (const w of watchedRows.values()) {
    ;(watched[w.showId] ??= []).push(w.episodeId)
    if (w.rating !== null) ratings[w.episodeId] = w.rating
  }
  return { shows, watched, ratings }
}

function localMovies(): Map<number, TrackedMovie> {
  return new Map(Object.values(getMoviesState().movies).map((m) => [m.id, m]))
}

function localArticles(): Map<string, Article> {
  return new Map(getArticlesState().map((a) => [a.id, a]))
}

// ---------------------------------------------------------------------------
// one job at a time

let chain: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task)
  chain = run.catch(() => undefined)
  return run
}

const queuedPush = new Set<StoreName>()
const changeSeq: Record<StoreName, number> = { library: 0, movies: 0, profile: 0, articles: 0 }

function requestPush(store: StoreName): Promise<void> {
  if (queuedPush.has(store)) return chain
  queuedPush.add(store)
  return enqueue(async () => {
    queuedPush.delete(store)
    await push(store)
  })
}

let pullQueued = false
let lastPullAt = 0

function requestPull(uid: string, seedLocal = false): Promise<void> {
  if (pullQueued && !seedLocal) return chain
  pullQueued = true
  return enqueue(async () => {
    pullQueued = false
    try {
      await pull(uid, seedLocal)
    } catch (err) {
      reportError('sync', err, { detail: 'pull' })
    }
  })
}

// ---------------------------------------------------------------------------
// lifecycle

const timers = new Map<StoreName, ReturnType<typeof setTimeout>>()
let unsubscribe: (() => void) | null = null

function flushTimers() {
  for (const [store, timer] of timers) {
    clearTimeout(timer)
    void requestPush(store)
  }
  timers.clear()
}

function onVisibility() {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'hidden') {
    flushTimers() // the app may be killed any moment now
    return
  }
  const uid = getSession()?.user.id
  if (!uid) return
  retryDirty(uid)
  if (Date.now() - lastPullAt > REPULL_AFTER_MS) void requestPull(uid)
}

function onOnline() {
  const uid = getSession()?.user.id
  if (uid) retryDirty(uid)
}

/** Push whatever is still marked dirty (or pull first, if there is no baseline yet). */
function retryDirty(uid: string) {
  for (const store of readDirty(uid)) {
    if (canPush(store, uid)) void requestPush(store)
    else void requestPull(uid)
  }
}

/** Start listening to local edits. Safe to call before the first pull: pushes wait for it. */
export function startSync() {
  if (unsubscribe || !supabase) return
  unsubscribe = onStoreChange((store) => {
    const uid = getSession()?.user.id
    if (!uid) return
    changeSeq[store]++
    markDirty(uid, store)
    clearTimeout(timers.get(store))
    timers.set(
      store,
      setTimeout(() => {
        timers.delete(store)
        void requestPush(store)
      }, DEBOUNCE_MS),
    )
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushTimers)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
  }
}

export function stopSync() {
  unsubscribe?.()
  unsubscribe = null
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  view = null
  lastPullAt = 0
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', flushTimers)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Push every pending edit now and wait for it — used before signing out. */
export async function flushSync(): Promise<void> {
  flushTimers()
  await chain
}

/**
 * Pull the account's cloud copy. Never rejects: failures are reported and
 * leave the affected table unpushable until a later pull succeeds.
 *
 * `seedLocal` is the one moment on-device history from before the account
 * existed is uploaded into it (the login where the username is claimed).
 */
export function pullAndHydrate(uid: string, seedLocal = false): Promise<void> {
  return requestPull(uid, seedLocal)
}

// ---------------------------------------------------------------------------
// push

function throwIfError(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message)
}

async function upsertRows(table: string, rows: object[]) {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    throwIfError(await supabase!.from(table).upsert(part))
  }
}

async function deleteRows(table: string, uid: string, column: string, keys: (number | string)[]) {
  for (const part of chunk(keys, DELETE_CHUNK)) {
    throwIfError(await supabase!.from(table).delete().eq('user_id', uid).in(column, part))
  }
}

async function push(store: StoreName) {
  const uid = getSession()?.user.id
  if (!supabase || !uid) return
  if (!canPush(store, uid)) {
    // never push blind: without a successful pull this device does not know
    // what the cloud holds
    void requestPull(uid)
    return
  }
  const seq = changeSeq[store]
  const cloud = view!
  try {
    if (store === 'library') await pushLibrary(uid, cloud)
    if (store === 'movies') await pushMovies(uid, cloud)
    if (store === 'profile') await pushProfile(uid)
    if (store === 'articles') await pushArticles(uid, cloud)
    // an edit that landed while this push was in flight is not in the cloud yet
    if (changeSeq[store] === seq) clearDirty(uid, store)
  } catch (err) {
    // A push failure is the most dangerous silent failure in the app: the
    // device looks fine while the cloud drifts out of date. The store stays
    // dirty, so it is retried and survives the next pull.
    reportError('sync', err, { detail: `push ${store}` })
  }
}

async function pushLibrary(uid: string, cloud: CloudView) {
  const state = getLibraryState()
  const tracks = localTracks(state)
  const watched = localWatched(state)
  const trackDiff = diffAgainstBaseline(tracks, cloud.tracks!, trackSig)
  const watchedDiff = diffAgainstBaseline(watched, cloud.watched!, watchedSig)

  await upsertRows(
    'tracks',
    trackDiff.upserts.map((s) => ({
      user_id: uid,
      show_id: s.id,
      name: s.name,
      image: s.image,
      status: s.status,
      network: s.network,
      premiered: s.premiered,
      added_at: new Date(s.addedAt).toISOString(),
    })),
  )
  await upsertRows(
    'watched',
    watchedDiff.upserts.map((w) => ({
      user_id: uid,
      show_id: w.showId,
      episode_id: w.episodeId,
      rating: w.rating,
    })),
  )
  await deleteRows('watched', uid, 'episode_id', watchedDiff.deletes)
  await deleteRows('tracks', uid, 'show_id', trackDiff.deletes)

  cloud.tracks = signatures(tracks, trackSig)
  cloud.watched = signatures(watched, watchedSig)
}

async function pushMovies(uid: string, cloud: CloudView) {
  const movies = localMovies()
  const diff = diffAgainstBaseline(movies, cloud.movies!, movieSig)
  await upsertRows(
    'movie_tracks',
    diff.upserts.map((m) => ({
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
    })),
  )
  await deleteRows('movie_tracks', uid, 'movie_id', diff.deletes)
  cloud.movies = signatures(movies, movieSig)
}

async function pushProfile(uid: string) {
  const p = getProfileState()
  if (!p.username) return // no claimed identity on this device yet — nothing valid to write
  throwIfError(
    await supabase!.from('profiles').upsert({
      id: uid,
      username: p.username,
      bio: p.bio,
      avatar_url: p.avatar,
      top10_shows: p.top10Shows,
      top10_episodes: p.top10Episodes,
      top10_movies: p.top10Movies,
    }),
  )
}

async function pushArticles(uid: string, cloud: CloudView) {
  const articles = localArticles()
  const diff = diffAgainstBaseline(articles, cloud.articles!, articleSig)
  await upsertRows(
    'articles',
    diff.upserts.map((a) => ({
      id: a.id,
      user_id: uid,
      title: a.title,
      body: a.body,
      subject: a.subject,
      created_at: new Date(a.createdAt).toISOString(),
    })),
  )
  await deleteRows('articles', uid, 'id', diff.deletes)
  cloud.articles = signatures(articles, articleSig)
}

// ---------------------------------------------------------------------------
// pull

// rows arrive untyped from PostgREST
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/**
 * Every row of one of the user's tables, page by page — never a truncated
 * first 1000, which a push would then treat as the complete picture.
 */
function fetchAll(table: string, column: string, uid: string, orderBy: string) {
  return fetchAllPages<Row>(
    (from, to) =>
      supabase!
        .from(table)
        .select('*')
        .eq(column, uid)
        .order(orderBy, { ascending: true })
        .range(from, to) as unknown as Promise<PageResult<Row>>,
  )
}

async function pull(uid: string, seedLocal: boolean) {
  if (!supabase) return

  const owner = lsGet(OWNER_KEY)
  if (owner && owner !== uid) {
    // someone else's leftovers (their session expired here): never show them
    // to, seed them into, or push them under this account
    clearLocalData()
  } else if (seedLocal && !owner) {
    // first claim on a device with anonymous history: treat all of it as
    // unsynced edits. It stays marked until it is safely in the cloud, so an
    // interrupted first sync resumes instead of wiping the device.
    writeDirty(uid, new Set(ALL_STORES))
  }
  lsSet(OWNER_KEY, uid)

  const [profileRes, tracksRes, watchedRes, moviesRes, articlesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    fetchAll('tracks', 'user_id', uid, 'show_id'),
    fetchAll('watched', 'user_id', uid, 'episode_id'),
    fetchAll('movie_tracks', 'user_id', uid, 'movie_id'),
    fetchAll('articles', 'user_id', uid, 'id'),
  ])

  // the account changed while this was in flight — the result is nobody's
  if (getSession()?.user.id !== uid) return

  const cloud = viewFor(uid)
  // read at hydrate time, not before the fetch: an edit made while the pull
  // was in flight must be merged, not overwritten
  const dirty = readDirty(uid)
  let failed = false

  const prof = profileRes.data as Row | null
  if (profileRes.error) {
    failed = true
    reportError('sync', profileRes.error, { detail: 'pull profile' })
  } else if (prof) {
    if (!dirty.has('profile')) {
      hydrateProfile({
        username: prof.username,
        bio: prof.bio ?? '',
        avatar: prof.avatar_url ?? null,
        top10Shows: Array.isArray(prof.top10_shows) ? prof.top10_shows : [],
        top10Episodes: Array.isArray(prof.top10_episodes) ? prof.top10_episodes : [],
        top10Movies: Array.isArray(prof.top10_movies) ? prof.top10_movies : [],
        following: [],
        followers: [],
      })
    }
    cloud.profile = true
  }

  if (tracksRes.error || watchedRes.error) {
    failed = true
    // a failed pull is what a truncated history looked like — hear about it
    reportError('sync', tracksRes.error ?? watchedRes.error, { detail: 'pull library' })
  } else {
    const cloudTracks = new Map<number, TrackedShow>()
    for (const t of tracksRes.rows) {
      cloudTracks.set(t.show_id, {
        id: t.show_id,
        name: t.name,
        image: t.image,
        status: t.status ?? '',
        network: t.network,
        premiered: t.premiered,
        addedAt: new Date(t.added_at).getTime(),
      })
    }
    const cloudWatched = new Map<number, WatchedEntry>()
    for (const w of watchedRes.rows) {
      cloudWatched.set(w.episode_id, {
        showId: w.show_id,
        episodeId: w.episode_id,
        rating: w.rating == null ? null : Number(w.rating),
      })
    }
    if (dirty.has('library')) {
      const state = getLibraryState()
      hydrateLibrary(
        toLibraryState(
          mergeWithCloud(cloudTracks, localTracks(state), cloud.tracks, trackSig),
          mergeWithCloud(cloudWatched, localWatched(state), cloud.watched, watchedSig),
        ),
      )
    } else {
      hydrateLibrary(toLibraryState(cloudTracks, cloudWatched))
    }
    cloud.tracks = signatures(cloudTracks, trackSig)
    cloud.watched = signatures(cloudWatched, watchedSig)
  }

  if (moviesRes.error) {
    failed = true
    reportError('sync', moviesRes.error, { detail: 'pull movies' })
  } else {
    const cloudMovies = new Map<number, TrackedMovie>()
    for (const m of moviesRes.rows) {
      cloudMovies.set(m.movie_id, {
        id: m.movie_id,
        title: m.title,
        year: m.year,
        poster: m.poster,
        genres: Array.isArray(m.genres) ? m.genres : [],
        runtime: m.runtime,
        status: (m.status as MovieStatus) ?? 'want',
        addedAt: new Date(m.added_at).getTime(),
        watchedAt: m.watched_at ? new Date(m.watched_at).getTime() : null,
      })
    }
    const merged = dirty.has('movies')
      ? mergeWithCloud(cloudMovies, localMovies(), cloud.movies, movieSig)
      : cloudMovies
    const movies: Record<number, TrackedMovie> = {}
    for (const [id, m] of merged) movies[id] = m
    hydrateMovies({ movies })
    cloud.movies = signatures(cloudMovies, movieSig)
  }

  if (articlesRes.error) {
    failed = true
    reportError('sync', articlesRes.error, { detail: 'pull articles' })
  } else {
    const author = (prof?.username as string | undefined) ?? getProfileState().username
    const cloudArticles = new Map<string, Article>()
    for (const a of articlesRes.rows) {
      cloudArticles.set(a.id, {
        id: a.id,
        title: a.title,
        body: a.body,
        subject: a.subject,
        author,
        createdAt: new Date(a.created_at).getTime(),
      })
    }
    const merged = dirty.has('articles')
      ? mergeWithCloud(cloudArticles, localArticles(), cloud.articles, articleSig)
      : cloudArticles
    hydrateArticles([...merged.values()].sort((a, b) => b.createdAt - a.createdAt))
    cloud.articles = signatures(cloudArticles, articleSig)
  }

  if (!failed) lastPullAt = Date.now()
  for (const store of dirty) {
    if (canPush(store, uid)) void requestPush(store)
  }
}

/**
 * Wipe on-device data. Called on sign-out so the next account on this
 * device never inherits (or accidentally seeds) the previous user's history.
 */
export function clearLocalData() {
  hydrateLibrary({ shows: {}, watched: {}, ratings: {} })
  hydrateMovies({ movies: {} })
  hydrateArticles([])
  resetProfile()
  lsSet(OWNER_KEY, null)
  lsSet(DIRTY_KEY, null)
  view = null
}
