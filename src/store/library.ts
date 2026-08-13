import { useSyncExternalStore } from 'react'
import { emitStoreChange } from '../lib/bus'
import type { TrackedShow, TvmShow } from '../types'

/**
 * Local-first library store. This is the swappable persistence layer:
 * v1 keeps everything in localStorage; the same interface will later be
 * backed by Supabase with sync, without the UI changing.
 */

export interface LibraryState {
  shows: Record<number, TrackedShow>
  /** watched episode ids per show */
  watched: Record<number, number[]>
  /** episode id → rating, 1–10 with one decimal */
  ratings: Record<number, number>
}

const STORAGE_KEY = 'mrwatch:library:v1'
const LEGACY_KEY = 'upnext:library:v1'

function load(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (raw) {
      // states saved before ratings existed lack the map — default it in
      const parsed = JSON.parse(raw) as LibraryState
      return { ...parsed, ratings: parsed.ratings ?? {} }
    }
  } catch {
    // corrupted state — start fresh rather than crash
  }
  return { shows: {}, watched: {}, ratings: {} }
}

let state: LibraryState = load()
const listeners = new Set<() => void>()
let hydrating = false

function commit(next: LibraryState) {
  state = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((l) => l())
  if (!hydrating) emitStoreChange('library')
}

export function getLibraryState(): LibraryState {
  return state
}

/** Replace local state with the cloud copy — never triggers a push. */
export function hydrateLibrary(next: LibraryState) {
  hydrating = true
  commit(next)
  hydrating = false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(subscribe, () => state)
}

export function trackShow(show: TvmShow) {
  const tracked: TrackedShow = {
    id: show.id,
    name: show.name,
    image: show.image?.medium ?? null,
    status: show.status,
    network: show.network?.name ?? show.webChannel?.name ?? null,
    premiered: show.premiered,
    addedAt: Date.now(),
  }
  commit({ ...state, shows: { ...state.shows, [show.id]: tracked } })
}

export function untrackShow(showId: number) {
  const shows = { ...state.shows }
  const watched = { ...state.watched }
  const ratings = { ...state.ratings }
  for (const epId of watched[showId] ?? []) delete ratings[epId]
  delete shows[showId]
  delete watched[showId]
  commit({ shows, watched, ratings })
}

export function setEpisodeWatched(showId: number, episodeId: number, isWatched: boolean) {
  const current = new Set(state.watched[showId] ?? [])
  const ratings = { ...state.ratings }
  if (isWatched) current.add(episodeId)
  else {
    current.delete(episodeId)
    delete ratings[episodeId] // an unwatched episode has no rating
  }
  commit({ ...state, ratings, watched: { ...state.watched, [showId]: [...current] } })
}

export function setManyWatched(showId: number, episodeIds: number[], isWatched: boolean) {
  const current = new Set(state.watched[showId] ?? [])
  const ratings = { ...state.ratings }
  for (const id of episodeIds) {
    if (isWatched) current.add(id)
    else {
      current.delete(id)
      delete ratings[id]
    }
  }
  commit({ ...state, ratings, watched: { ...state.watched, [showId]: [...current] } })
}

/** 1–10, one decimal. Rating an episode marks it watched; null clears. */
export function setEpisodeRating(showId: number, episodeId: number, rating: number | null) {
  const ratings = { ...state.ratings }
  const current = new Set(state.watched[showId] ?? [])
  if (rating === null) {
    delete ratings[episodeId]
  } else {
    ratings[episodeId] = Math.min(10, Math.max(1, Math.round(rating * 10) / 10))
    current.add(episodeId)
  }
  commit({ ...state, ratings, watched: { ...state.watched, [showId]: [...current] } })
}
