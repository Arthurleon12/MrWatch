import { useSyncExternalStore } from 'react'
import { emitStoreChange } from '../lib/bus'
import type { TrackedShow, TvmShow } from '../types'

/**
 * Local-first library store. This is the swappable persistence layer:
 * v1 keeps everything in localStorage; the same interface will later be
 * backed by Supabase with sync, without the UI changing.
 */

interface LibraryState {
  shows: Record<number, TrackedShow>
  /** watched episode ids per show */
  watched: Record<number, number[]>
}

const STORAGE_KEY = 'mrwatch:library:v1'
const LEGACY_KEY = 'upnext:library:v1'

function load(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (raw) return JSON.parse(raw) as LibraryState
  } catch {
    // corrupted state — start fresh rather than crash
  }
  return { shows: {}, watched: {} }
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
  delete shows[showId]
  delete watched[showId]
  commit({ shows, watched })
}

export function setEpisodeWatched(showId: number, episodeId: number, isWatched: boolean) {
  const current = new Set(state.watched[showId] ?? [])
  if (isWatched) current.add(episodeId)
  else current.delete(episodeId)
  commit({ ...state, watched: { ...state.watched, [showId]: [...current] } })
}

export function setManyWatched(showId: number, episodeIds: number[], isWatched: boolean) {
  const current = new Set(state.watched[showId] ?? [])
  for (const id of episodeIds) {
    if (isWatched) current.add(id)
    else current.delete(id)
  }
  commit({ ...state, watched: { ...state.watched, [showId]: [...current] } })
}
