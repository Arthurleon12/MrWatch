import type { TvmEpisode } from '../types'

export function episodeAirTime(ep: TvmEpisode): Date | null {
  if (ep.airstamp) return new Date(ep.airstamp)
  if (ep.airdate) return new Date(`${ep.airdate}T00:00:00`)
  return null
}

export function hasAired(ep: TvmEpisode, now = new Date()): boolean {
  const at = episodeAirTime(ep)
  return at !== null && at.getTime() <= now.getTime()
}

export function epCode(ep: TvmEpisode): string {
  if (ep.number === null) return `S${ep.season} Special`
  return `S${ep.season}E${String(ep.number).padStart(2, '0')}`
}

const DAY_MS = 86_400_000

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** "Today", "Tomorrow", "Friday", or "Sep 4" — in the user's timezone. */
export function dayLabel(date: Date, now = new Date()): string {
  const diffDays = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function shortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
}

export function timeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "3d ago", "2w ago" — how long an episode has been waiting. */
export function agoLabel(date: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
