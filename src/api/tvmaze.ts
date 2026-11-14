import type { TvmScheduleItem, TvmSearchResult, TvmShow } from '../types'

const BASE = 'https://api.tvmaze.com'

/**
 * A non-2xx answer from one of the catalogue APIs. Carrying the status lets
 * callers tell "gone for good" (4xx — retrying is pointless) from "try again"
 * (5xx, network), instead of string-matching an error message.
 */
export class HttpError extends Error {
  readonly status: number

  constructor(service: string, status: number, path: string) {
    super(`${service} ${status} for ${path}`)
    this.name = 'HttpError'
    this.status = status
  }
}

/** A request the server refused outright — asking again will not change it. */
export function isClientError(error: unknown): boolean {
  return error instanceof HttpError && error.status >= 400 && error.status < 500
}

/* ------------------------------ concurrency ------------------------------ */

// TVmaze allows ~20 calls per 10 s per IP. A page that tracks 60 shows used to
// fire 60 requests at once, get 40 of them refused, and then retry all 40 in
// lockstep. A small pool keeps the burst under the limit in the first place.
const MAX_PARALLEL = 4
let active = 0
const waiters: (() => void)[] = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) {
    // the finishing request hands its slot straight to us, so `active` is
    // already counting this call when the wait ends
    await new Promise<void>((resolve) => waiters.push(resolve))
  } else {
    active++
  }
  try {
    return await fn()
  } finally {
    const next = waiters.shift()
    if (next) next()
    else active--
  }
}

/* --------------------------- timeouts and aborts -------------------------- */

const TIMEOUT_MS = 15_000
const MAX_429_RETRIES = 3
const MAX_RETRY_AFTER_MS = 15_000

/**
 * One signal that fires on whichever comes first: the caller giving up (a
 * query unmounting, a newer search superseding this one) or the request
 * running past TIMEOUT_MS — a hung connection must not spin forever.
 */
function requestSignal(outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('TVmaze request timed out', 'TimeoutError')),
    TIMEOUT_MS,
  )
  const onAbort = () => controller.abort(outer?.reason)
  if (outer?.aborted) onAbort()
  else outer?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    },
  }
}

/** A wait that ends early (by rejecting) if the caller gives up meanwhile. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * How long to wait after a 429: what the server asked for when it says, else
 * exponential — plus jitter either way, so requests refused together do not
 * all come back together.
 */
export function backoffMs(attempt: number, retryAfterSeconds: number, random = Math.random()): number {
  const base =
    retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS)
      : 2000 * 2 ** attempt
  return base + random * 1000
}

/* --------------------------------- fetch --------------------------------- */

async function get<T>(path: string, signal?: AbortSignal, attempt = 0): Promise<T> {
  // already given up on (a superseded search, an unmounted page): don't queue
  signal?.throwIfAborted()
  const outcome = await withSlot(async (): Promise<{ data: T } | { retryAfter: number }> => {
    const request = requestSignal(signal)
    try {
      const res = await fetch(`${BASE}${path}`, { signal: request.signal })
      if (res.status === 429) return { retryAfter: Number(res.headers.get('Retry-After')) }
      if (!res.ok) throw new HttpError('TVmaze', res.status, path)
      // inside the timeout: a large body on a stalled connection hangs too
      return { data: (await res.json()) as T }
    } finally {
      request.done()
    }
  })
  if ('data' in outcome) return outcome.data

  // rate-limited: wait OUTSIDE the pool, so a backing-off request does not
  // hold a slot the others could be using
  if (attempt >= MAX_429_RETRIES) throw new HttpError('TVmaze', 429, path)
  await sleep(backoffMs(attempt, outcome.retryAfter), signal)
  return get<T>(path, signal, attempt + 1)
}

export function searchShows(query: string, signal?: AbortSignal): Promise<TvmSearchResult[]> {
  return get(`/search/shows?q=${encodeURIComponent(query)}`, signal)
}

export function getShowWithEpisodes(id: number, signal?: AbortSignal): Promise<TvmShow> {
  return get(`/shows/${id}?embed=episodes`, signal)
}

/** The TVmaze show for an IMDb id. Rejects with an HttpError 404 when TVmaze has none. */
export function lookupShowByImdb(imdbId: string, signal?: AbortSignal): Promise<TvmShow> {
  return get(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, signal)
}

export function isoDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Broadcast schedule for a date (episodes airing on US networks). */
export function getTodaySchedule(date = isoDate(), signal?: AbortSignal): Promise<TvmScheduleItem[]> {
  return get(`/schedule?country=US&date=${date}`, signal)
}

/**
 * Streaming releases for a date (episodes with the show embedded).
 * No country filter: anime and international shows release on global
 * web channels that a US-only query would miss.
 */
export function getTodayWebSchedule(date = isoDate(), signal?: AbortSignal): Promise<TvmScheduleItem[]> {
  return get(`/schedule/web?date=${date}`, signal)
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

/** TVmaze summaries are HTML fragments; render them as plain text. */
export function stripHtml(html: string | null): string {
  if (!html) return ''
  return (
    html
      // a block boundary is a word boundary: "<p>One.</p><p>Two.</p>" is two sentences
      .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&#(\d+);/g, (_, code: string) => codePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
      .replace(/&([a-z]+);/gi, (whole: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
      // last, so "&amp;lt;" ends up as the literal text "&lt;" rather than "<"
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function codePoint(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}
