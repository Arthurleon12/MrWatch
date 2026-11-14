import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  clearLocalData,
  flushSync,
  hasUnsyncedChanges,
  startSync,
  stopSync,
  pullAndHydrate,
} from '../lib/sync'

/**
 * Auth session state. `profileStatus` tracks whether the signed-in user has
 * claimed a username yet (a `profiles` row exists) — until they have, the
 * app treats them as onboarding.
 */

export type ProfileStatus = 'unknown' | 'missing' | 'ready'

interface SessionState {
  session: Session | null
  profileStatus: ProfileStatus
  initializing: boolean
}

let state: SessionState = { session: null, profileStatus: 'unknown', initializing: true }
const listeners = new Set<() => void>()

function set(next: Partial<SessionState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state)
}

export function getSession(): Session | null {
  return state.session
}

const RETRY_MS = 5000
let refreshingFor: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

async function refreshProfileStatus() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (!supabase || !state.session) {
    set({ profileStatus: 'unknown' })
    return
  }
  const uid = state.session.user.id
  if (refreshingFor === uid) return // boot fires this twice; one lookup is enough
  refreshingFor = uid
  try {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', uid).maybeSingle()
    if (state.session?.user.id !== uid) return // signed out or switched meanwhile
    if (error) {
      // A failed lookup is NOT "no profile": treating it as one sends an
      // existing user to the username-claim screen. Stay unknown and retry.
      set({ profileStatus: 'unknown' })
      retryTimer = setTimeout(() => void refreshProfileStatus(), RETRY_MS)
      return
    }
    set({ profileStatus: data ? 'ready' : 'missing' })
    if (data) {
      // listen first: an edit made while the pull is in flight is kept
      startSync()
      await pullAndHydrate(uid)
    }
  } finally {
    if (refreshingFor === uid) refreshingFor = null
  }
}

/** Call once at app boot. */
export function initAuth() {
  if (!supabase) {
    set({ initializing: false })
    return
  }
  supabase.auth.getSession().then(({ data }) => {
    set({ session: data.session, initializing: false })
    void refreshProfileStatus()
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    const changed = session?.user.id !== state.session?.user.id
    set({ session, initializing: false })
    if (changed) {
      stopSync()
      if (session) void refreshProfileStatus()
      else set({ profileStatus: 'unknown' })
    }
  })
}

/** After the username claim inserts the profiles row. */
export async function markProfileClaimed() {
  set({ profileStatus: 'ready' })
  if (state.session) {
    // the one moment pre-account on-device history seeds the new account
    startSync()
    await pullAndHydrate(state.session.user.id, true)
  }
}

/** Starts the provider redirect. Resolves to a message only if it could not start. */
export async function signInWithProvider(provider: 'google' | 'apple'): Promise<string | null> {
  if (!supabase) return 'Backend not configured.'
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth` },
    })
    return error ? error.message : null
  } catch {
    return 'Couldn’t reach the sign-in service — check your connection and try again.'
  }
}

export async function signInWithEmail(email: string): Promise<string | null> {
  if (!supabase) return 'Backend not configured.'
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth` },
  })
  return error ? error.message : null
}

/**
 * Installed-app path: the magic link would open in the browser, not the
 * home-screen app — typing the emailed code signs in without leaving it.
 */
export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Backend not configured.'
  const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
  return error ? error.message : null
}

/**
 * Signing out wipes this device, so anything the cloud has not confirmed is
 * lost for good. Pending edits are pushed first; if some still could not be
 * saved (offline, say) this returns 'unsynced' and does nothing, unless
 * `force` says the user chose to lose them.
 */
export async function signOut(force = false): Promise<'done' | 'unsynced'> {
  await flushSync() // an edit made a second ago must reach the cloud before the device is wiped
  if (!force && state.session && hasUnsyncedChanges(state.session.user.id)) return 'unsynced'
  stopSync()
  await supabase?.auth.signOut()
  clearLocalData() // the next account on this device starts clean
  return 'done'
}

/** Permanently deletes the auth user; cascades wipe all their rows. */
export async function deleteAccount(): Promise<string | null> {
  if (!supabase) return 'Backend not configured.'
  const { error } = await supabase.rpc('delete_user')
  if (error) return error.message
  stopSync()
  await supabase.auth.signOut()
  clearLocalData()
  return null
}
