import { hasAired } from './time'
import type { TvmShow } from '../types'

/**
 * Spoiler-gating.
 *
 * The rule, applied everywhere: an episode's title (and anything written
 * about it) is hidden when at least one episode you haven't watched has
 * already aired BEFORE it. That single test does the right thing in every
 * case we care about:
 *
 *   - caught up → nothing is hidden, not even next week's episode
 *   - three seasons behind → today's episode title is hidden
 *   - never started → the pilot stays visible, the rest doesn't
 *   - a gap left mid-season → everything after the gap is hidden
 *
 * Shows you don't track are never gated — you can't be spoiled on a story
 * you aren't following, and gating them would wreck browsing. Progress is
 * derived from episode metadata we already hold, so nothing extra is stored
 * or synced.
 */

export interface EpisodeRef {
  season: number
  number: number
}

/** Parses "S5E01" / "s05e1". Specials ("S5 Special") have no place in the order. */
export function parseEpCode(code: string | null | undefined): EpisodeRef | null {
  if (!code) return null
  const match = /^s(\d+)e(\d+)$/i.exec(code.trim())
  if (!match) return null
  return { season: Number(match[1]), number: Number(match[2]) }
}

/** Chronological order: season first, then episode number. */
export function compareRefs(a: EpisodeRef, b: EpisodeRef): number {
  return a.season - b.season || a.number - b.number
}

export interface ShowProgress {
  /**
   * The earliest episode that has aired and you haven't watched — the point
   * you're "up to". Null when you're fully caught up: then nothing can spoil.
   */
  frontier: EpisodeRef | null
}

/**
 * Where the viewer is up to in each show. Only shows we hold episode metadata
 * for appear here; everything else stays unknown rather than being guessed at.
 */
export function buildProgress(
  details: TvmShow[],
  watched: Record<number, number[]>,
  now = new Date(),
): Map<number, ShowProgress> {
  const progress = new Map<number, ShowProgress>()
  for (const show of details) {
    const seen = new Set(watched[show.id] ?? [])
    let frontier: EpisodeRef | null = null
    for (const ep of show._embedded?.episodes ?? []) {
      if (ep.number === null || seen.has(ep.id) || !hasAired(ep, now)) continue
      const ref = { season: ep.season, number: ep.number }
      if (!frontier || compareRefs(ref, frontier) < 0) frontier = ref
    }
    progress.set(show.id, { frontier })
  }
  return progress
}

/**
 * Would seeing this episode's title spoil something the viewer hasn't got to?
 * Unknown show (untracked, or metadata not loaded) → never a spoiler.
 */
export function isSpoiler(ref: EpisodeRef | null, progress: ShowProgress | undefined): boolean {
  if (!ref || !progress?.frontier) return false
  return compareRefs(ref, progress.frontier) > 0
}
