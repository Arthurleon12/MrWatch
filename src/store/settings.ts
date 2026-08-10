import { useSyncExternalStore } from 'react'

/**
 * App settings. The TMDB key is entered by the owner in Profile → Connections
 * and stored on-device only. NOTE for the future hosted version: a browser
 * app should call TMDB through our own backend proxy so the key is never
 * shipped to clients — fine for personal/local use in the meantime.
 */

interface SettingsState {
  tmdbKey: string
}

const STORAGE_KEY = 'mrwatch:settings:v1'

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...{ tmdbKey: '' }, ...(JSON.parse(raw) as Partial<SettingsState>) }
  } catch {
    // fall through
  }
  return { tmdbKey: '' }
}

let state: SettingsState = load()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): SettingsState {
  return useSyncExternalStore(subscribe, () => state)
}

export function updateSettings(patch: Partial<SettingsState>) {
  state = { ...state, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((l) => l())
}
