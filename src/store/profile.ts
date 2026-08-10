import { useSyncExternalStore } from 'react'
import { emitStoreChange } from '../lib/bus'

/**
 * Local profile store. Single-user for now; when Supabase lands, this same
 * shape becomes the `profiles` row + `follows` table, and username
 * uniqueness / reservations get enforced server-side.
 */

/**
 * Usernames reserved for the app owner (Arthur). The server MUST reject
 * these at registration for anyone else once accounts go live.
 */
export const RESERVED_USERNAMES = ['arthur', 'mrwatch']
export const OWNER_RESERVED = true // this local install belongs to the owner

export interface Top10Show {
  id: number
  name: string
  image: string | null
}

export interface Top10Episode {
  id: number
  showId: number
  showName: string
  code: string // "S5E01"
  name: string
  image: string | null // show poster
}

export interface ProfileState {
  username: string
  bio: string
  avatar: string | null // data URL, downscaled
  top10Shows: Top10Show[]
  top10Episodes: Top10Episode[]
  /** usernames — populated for real once accounts exist */
  following: string[]
  followers: string[]
}

const STORAGE_KEY = 'mrwatch:profile:v1'

const DEFAULT_PROFILE: ProfileState = {
  username: 'Arthur',
  bio: '',
  avatar: null,
  top10Shows: [],
  top10Episodes: [],
  following: [],
  followers: [],
}

function load(): ProfileState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as ProfileState) }
  } catch {
    // fall through to default
  }
  return DEFAULT_PROFILE
}

let state: ProfileState = load()
const listeners = new Set<() => void>()
let hydrating = false

function commit(next: ProfileState) {
  state = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((l) => l())
  if (!hydrating) emitStoreChange('profile')
}

export function getProfileState(): ProfileState {
  return state
}

/** Replace local state with the cloud copy — never triggers a push. */
export function hydrateProfile(next: ProfileState) {
  hydrating = true
  commit(next)
  hydrating = false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProfile(): ProfileState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Returns an error message, or null if the username is acceptable. */
export function validateUsername(name: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
    return 'Usernames are 3–20 characters: letters, numbers, underscores.'
  }
  if (RESERVED_USERNAMES.includes(name.toLowerCase()) && !OWNER_RESERVED) {
    return 'That name is reserved.'
  }
  return null
}

export function updateProfile(patch: Partial<Pick<ProfileState, 'username' | 'bio' | 'avatar'>>) {
  commit({ ...state, ...patch })
}

export function setTop10Shows(list: Top10Show[]) {
  commit({ ...state, top10Shows: list.slice(0, 10) })
}

export function setTop10Episodes(list: Top10Episode[]) {
  commit({ ...state, top10Episodes: list.slice(0, 10) })
}

/** Downscale an uploaded image to a small square data URL for storage. */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const SIZE = 192
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      // cover-crop to square
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}
