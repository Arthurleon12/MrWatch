import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearLocalData, startSync, stopSync, pullAndHydrate } from '../lib/sync'

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

async function refreshProfileStatus() {
  if (!supabase || !state.session) {
    set({ profileStatus: 'unknown' })
    return
  }
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', state.session.user.id)
    .maybeSingle()
  set({ profileStatus: data ? 'ready' : 'missing' })
  if (data) {
    await pullAndHydrate(state.session.user.id)
    startSync()
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
    await pullAndHydrate(state.session.user.id, true)
    startSync()
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

export async function signOut() {
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
