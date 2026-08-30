import { supabase } from './supabase'
import { getSession } from '../store/session'

/**
 * Production error reporting.
 *
 * CI catches what it can see; this catches the rest — render crashes,
 * unhandled rejections and, above all, SILENT SYNC FAILURES. The bug that
 * destroyed watch history in August failed exactly this way: it logged to a
 * console nobody was reading and looked fine from the outside. Reports go to
 * the client_errors table (supabase/migrations/2026-08-30-error-log.sql).
 *
 * Three rules this module never breaks:
 *   1. reporting an error must never throw one
 *   2. a crash loop must never become a write loop
 *   3. nothing identifying leaves the device — routes are logged as their
 *      pattern ("/u/:username"), never as the path someone actually visited
 */

export type ErrorKind = 'render' | 'unhandled' | 'rejection' | 'sync' | 'manual'

const MAX_MESSAGE = 500
const MAX_STACK = 4000
const MAX_AGENT = 400

/** Per page load — enough to see a pattern, not enough to hammer the table. */
const MAX_REPORTS = 12

/** The same failure repeating is one story, not fifty. */
const REPEAT_WINDOW_MS = 60_000

/* ------------------------------ pure helpers ----------------------------- */

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Anything can be thrown in JavaScript. Get a message out of it regardless. */
export function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: truncate(error.message || error.name || 'Error', MAX_MESSAGE),
      stack: error.stack ? truncate(error.stack, MAX_STACK) : null,
    }
  }
  if (typeof error === 'string') {
    return { message: truncate(error || 'Unknown error', MAX_MESSAGE), stack: null }
  }
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) {
      return { message: truncate(message, MAX_MESSAGE), stack: null }
    }
    try {
      return { message: truncate(JSON.stringify(error), MAX_MESSAGE), stack: null }
    } catch {
      // circular, or a Proxy that objects to being read
      return { message: 'Unserializable error', stack: null }
    }
  }
  return { message: 'Unknown error', stack: null }
}

/** Routes that carry nothing identifying and can be logged as they are. */
const STATIC_ROUTES = new Set([
  '/',
  '/schedule',
  '/foryou',
  '/search',
  '/profile',
  '/settings',
  '/write',
  '/auth',
  '/notifications',
])

const ROUTE_PATTERNS: { test: RegExp; pattern: string }[] = [
  { test: /^\/show\/[^/]+\/?$/, pattern: '/show/:id' },
  { test: /^\/movie\/[^/]+\/?$/, pattern: '/movie/:id' },
  { test: /^\/article\/[^/]+\/?$/, pattern: '/article/:id' },
  { test: /^\/rank\/movie\/[^/]+\/?$/, pattern: '/rank/movie/:id' },
  { test: /^\/rank\/[^/]+\/?$/, pattern: '/rank/:id' },
  { test: /^\/u\/[^/]+\/?$/, pattern: '/u/:username' },
  { test: /^\/together\/[^/]+\/?$/, pattern: '/together/:username' },
  { test: /^\/friends\/[^/]+\/followers\/?$/, pattern: '/friends/:username/followers' },
  { test: /^\/friends\/[^/]+\/following\/?$/, pattern: '/friends/:username/following' },
]

/**
 * A path reduced to the route it matched. Grouping errors by screen is what
 * makes them readable; knowing whose profile was open adds nothing and would
 * put usernames in a log. Anything unrecognised (a 404) becomes "/other"
 * rather than leaking whatever was typed into the address bar.
 */
export function scrubRoute(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  if (STATIC_ROUTES.has(path)) return path
  for (const { test, pattern } of ROUTE_PATTERNS) {
    if (test.test(pathname)) return pattern
  }
  return '/other'
}

export interface ThrottleState {
  /** signature → when it was last sent */
  seen: Map<string, number>
  sent: number
}

export function createThrottle(): ThrottleState {
  return { seen: new Map(), sent: 0 }
}

/**
 * Claims a slot for this report, or refuses it. Refuses once the page has
 * sent its budget, and refuses a signature already reported inside the
 * repeat window — a component that throws on every render must cost one row,
 * not one per frame.
 */
export function takeReportSlot(state: ThrottleState, signature: string, now: number): boolean {
  if (state.sent >= MAX_REPORTS) return false
  const last = state.seen.get(signature)
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false
  state.seen.set(signature, now)
  state.sent++
  return true
}

/* ------------------------------- reporting ------------------------------- */

const throttle = createThrottle()
let installed = false
let tableMissing = false

const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev'

export function reportError(kind: ErrorKind, error: unknown, extra?: { detail?: string }) {
  try {
    const { message, stack } = normalizeError(error)
    const route = typeof location === 'undefined' ? null : scrubRoute(location.pathname)
    if (!takeReportSlot(throttle, `${kind}|${route}|${message}`, Date.now())) return

    // the console stays useful for whoever has devtools open
    console.error(`[mrwatch] ${kind}`, error)
    if (!supabase || tableMissing) return

    const detail = extra?.detail ? `${extra.detail}\n\n` : ''
    void supabase
      .from('client_errors')
      .insert({
        user_id: getSession()?.user.id ?? null,
        kind,
        message,
        stack: stack || detail ? truncate(`${detail}${stack ?? ''}`, MAX_STACK) : null,
        route,
        build: BUILD_ID,
        user_agent: truncate(navigator.userAgent, MAX_AGENT),
      })
      .then(({ error: insertError }) => {
        if (!insertError) return
        // never report the reporter: that is how you build an infinite loop
        if (/client_errors|schema cache/i.test(insertError.message)) {
          tableMissing = true
          console.warn('[report] not logging — run supabase/migrations/2026-08-30-error-log.sql')
        }
      })
  } catch {
    // reporting is never allowed to be the thing that breaks the app
  }
}

/** Catches what never reaches a React boundary. Safe to call more than once. */
export function initErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    // a failed image or script fires this with no Error attached — noise
    if (!event.error) return
    reportError('unhandled', event.error)
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError('rejection', event.reason)
  })
}
