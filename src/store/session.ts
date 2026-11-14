import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearLocalData, flushSync, startSync, stopSync, pullAndHydrate } from '../lib/sync'

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

export function signInWithProvider(provider: 'google' | 'apple') {
  if (!supabase) return
  void supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth` },
  })
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

export async function signOut() {
  await flushSync() // an edit made a second ago must reach the cloud before the device is wiped
  stopSync()
  await supabase?.auth.signOut()
  clearLocalData() // the next account on this device starts clean
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
