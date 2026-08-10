import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client, or null when the app runs in local-only mode (no env
 * vars set). Every cloud feature checks `backendReady` and degrades to the
 * on-device experience when it's false.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export const backendReady = supabase !== null
