import type { ArticleSubject } from '../store/articles'
import type { Top10Show } from '../store/profile'

/**
 * Rows written by other people (or by an older build) are untrusted input:
 * one malformed row must cost that row, never the whole screen.
 */

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** An article subject we can safely render and link — or null to drop the article. */
export function cleanSubject(raw: unknown): ArticleSubject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (typeof s.showId !== 'number' || !Number.isFinite(s.showId)) return null
  if (typeof s.showName !== 'string') return null
  return {
    showId: s.showId,
    showName: s.showName,
    image: typeof s.image === 'string' ? s.image : null,
    epCode: optionalString(s.epCode),
    epName: optionalString(s.epName),
  }
}

/** The loose label shape used by post lists: only strings survive. */
export function cleanSubjectLabel(raw: unknown): { showName?: string; epCode?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const s = raw as Record<string, unknown>
  return { showName: optionalString(s.showName), epCode: optionalString(s.epCode) }
}

/** A Top 10 ladder from someone else's profile row: an array of well-formed entries. */
export function cleanLadder(raw: unknown): Top10Show[] {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  const out: Top10Show[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'number' || !Number.isFinite(e.id) || typeof e.name !== 'string') continue
    out.push({ id: e.id, name: e.name, image: typeof e.image === 'string' ? e.image : null })
  }
  return out
}
