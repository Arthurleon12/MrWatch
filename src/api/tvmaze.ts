import type { TvmScheduleItem, TvmSearchResult, TvmShow } from '../types'

const BASE = 'https://api.tvmaze.com'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`TVmaze ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

export function searchShows(query: string): Promise<TvmSearchResult[]> {
  return get(`/search/shows?q=${encodeURIComponent(query)}`)
}

export function getShowWithEpisodes(id: number): Promise<TvmShow> {
  return get(`/shows/${id}?embed=episodes`)
}

export function isoDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Broadcast schedule for a date (episodes airing on US networks). */
export function getTodaySchedule(date = isoDate()): Promise<TvmScheduleItem[]> {
  return get(`/schedule?country=US&date=${date}`)
}

/**
 * Streaming releases for a date (episodes with the show embedded).
 * No country filter: anime and international shows release on global
 * web channels that a US-only query would miss.
 */
export function getTodayWebSchedule(date = isoDate()): Promise<TvmScheduleItem[]> {
  return get(`/schedule/web?date=${date}`)
}

/** TVmaze summaries are HTML fragments; render them as plain text. */
export function stripHtml(html: string | null): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
