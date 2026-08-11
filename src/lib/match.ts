import type { TvmShow } from '../types'
import type { Top10Show } from '../store/profile'

/**
 * Taste Match — the MrWatch AI pairing engine.
 *
 * Two people's histories (tracked shows weighted by real engagement, watched
 * movies, ladder positions) are collapsed into comparable taste snapshots.
 * From those we compute:
 *   - a compatibility percentage with a human-readable breakdown, and
 *   - joint scores for candidate movies/shows, using a "least misery" blend:
 *     a pick has to work for BOTH people, not just on average.
 */

/* --------------------------- genre normalizing --------------------------- */

// TVmaze says "Science-Fiction", TMDB says "Science Fiction"; TVmaze tags
// anime as its own genre while TMDB files it under Animation. Normalize so
// TV taste transfers to movies and vice versa.
export function normGenre(genre: string): string {
  const key = genre.toLowerCase().replace(/[-_]/g, ' ').trim()
  return key === 'anime' ? 'animation' : key
}

function displayGenre(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ----------------------------- taste snapshot ---------------------------- */

export interface TasteSourceMovie {
  id: number
  title: string
  poster: string | null
  genres: string[]
  status: 'want' | 'watched'
}

/** Everything we know about one person's taste, ready for comparison. */
export interface TasteSnapshot {
  username: string
  trackedShows: { id: number; name: string; image: string | null }[]
  watchedCounts: Record<number, number>
  ladderShows: Top10Show[]
  ladderMovies: Top10Show[]
  watchedMovies: TasteSourceMovie[]
  wantMovies: TasteSourceMovie[]
  /** normalized genre key → weight (max 1), from shows AND movies */
  genreWeights: Map<string, number>
}

export function buildTasteSnapshot(input: {
  username: string
  tracked: { id: number; name: string; image: string | null }[]
  /** TVmaze details for (a subset of) tracked shows — supplies genres */
  showDetails: TvmShow[]
  watchedCounts: Record<number, number>
  ladderShows: Top10Show[]
  ladderMovies: Top10Show[]
  movies: TasteSourceMovie[]
}): TasteSnapshot {
  const genreWeights = new Map<string, number>()
  const add = (genre: string, weight: number) => {
    const key = normGenre(genre)
    if (key) genreWeights.set(key, (genreWeights.get(key) ?? 0) + weight)
  }

  const detailById = new Map(input.showDetails.map((d) => [d.id, d]))
  for (const t of input.tracked) {
    const watchedCount = input.watchedCounts[t.id] ?? 0
    const ladderIndex = input.ladderShows.findIndex((l) => l.id === t.id)
    // same engagement weighting as the solo recommendation engine
    const weight = 1 + Math.log2(1 + watchedCount) + (ladderIndex >= 0 ? (10 - ladderIndex) / 3 : 0)
    for (const g of detailById.get(t.id)?.genres ?? []) add(g, weight)
  }

  for (const m of input.movies) {
    const ladderIndex = input.ladderMovies.findIndex((l) => l.id === m.id)
    const weight =
      m.status === 'watched' ? 1 + (ladderIndex >= 0 ? (10 - ladderIndex) / 3 : 0) : 0.4
    for (const g of m.genres) add(g, weight)
  }

  const max = Math.max(1e-9, ...genreWeights.values())
  for (const [k, v] of genreWeights) genreWeights.set(k, v / max)

  return {
    username: input.username,
    trackedShows: input.tracked,
    watchedCounts: input.watchedCounts,
    ladderShows: input.ladderShows,
    ladderMovies: input.ladderMovies,
    watchedMovies: input.movies.filter((m) => m.status === 'watched'),
    wantMovies: input.movies.filter((m) => m.status === 'want'),
    genreWeights,
  }
}

/* ------------------------------ taste match ------------------------------ */

export interface TasteMatch {
  /** 0–100 compatibility */
  percent: number
  sharedShows: { id: number; name: string; image: string | null }[]
  sharedMovies: { id: number; title: string; poster: string | null }[]
  /** display-ready genre names both people are into */
  sharedGenres: string[]
  /** titles both people put on their ladders */
  ladderAgreements: { name: string; rankA: number; rankB: number }[]
  /** false while either side has too little history to mean much */
  hasEnoughData: boolean
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const v of a.values()) normA += v * v
  for (const v of b.values()) normB += v * v
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0)
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function computeTasteMatch(a: TasteSnapshot, b: TasteSnapshot): TasteMatch {
  const bShowIds = new Set(b.trackedShows.map((s) => s.id))
  const sharedShows = a.trackedShows.filter((s) => bShowIds.has(s.id))

  const bMovieIds = new Set(b.watchedMovies.map((m) => m.id))
  const sharedMovies = a.watchedMovies
    .filter((m) => bMovieIds.has(m.id))
    .map((m) => ({ id: m.id, title: m.title, poster: m.poster }))

  const ladderAgreements: TasteMatch['ladderAgreements'] = []
  for (const [mineLadder, theirsLadder] of [
    [a.ladderShows, b.ladderShows],
    [a.ladderMovies, b.ladderMovies],
  ] as const) {
    for (let i = 0; i < mineLadder.length; i++) {
      const j = theirsLadder.findIndex((t) => t.id === mineLadder[i].id)
      if (j >= 0) ladderAgreements.push({ name: mineLadder[i].name, rankA: i + 1, rankB: j + 1 })
    }
  }

  // components, each 0..1, skipped when either side lacks the data
  const parts: { weight: number; value: number }[] = []

  if (a.genreWeights.size > 0 && b.genreWeights.size > 0) {
    // cosine runs hot (everyone likes Drama) — a gentle power spreads it out
    parts.push({ weight: 0.45, value: Math.pow(cosine(a.genreWeights, b.genreWeights), 1.25) })
  }
  if (a.trackedShows.length > 0 && b.trackedShows.length > 0) {
    const containment = sharedShows.length / Math.min(a.trackedShows.length, b.trackedShows.length)
    parts.push({ weight: 0.3, value: containment })
  }
  if (a.watchedMovies.length > 0 && b.watchedMovies.length > 0) {
    const containment = sharedMovies.length / Math.min(a.watchedMovies.length, b.watchedMovies.length)
    parts.push({ weight: 0.15, value: containment })
  }
  if (ladderAgreements.length > 0) {
    const closeness =
      ladderAgreements.reduce((acc, l) => acc + (1 - Math.abs(l.rankA - l.rankB) / 10), 0) /
      ladderAgreements.length
    parts.push({ weight: 0.1, value: closeness })
  }

  const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0)
  const percent =
    totalWeight > 0
      ? Math.round((parts.reduce((acc, p) => acc + p.weight * p.value, 0) / totalWeight) * 100)
      : 0

  const sharedGenres = [...a.genreWeights.entries()]
    .map(([key, wa]) => ({ key, min: Math.min(wa, b.genreWeights.get(key) ?? 0) }))
    .filter((g) => g.min > 0.2)
    .sort((x, y) => y.min - x.min)
    .slice(0, 3)
    .map((g) => displayGenre(g.key))

  const substance = (s: TasteSnapshot) => s.trackedShows.length + s.watchedMovies.length
  return {
    percent,
    sharedShows,
    sharedMovies,
    sharedGenres,
    ladderAgreements,
    hasEnoughData: substance(a) >= 2 && substance(b) >= 2,
  }
}

/* --------------------------- joint movie scoring -------------------------- */

/** 0..1 — how well a set of genres fits one person's taste. */
export function genreFitFor(genres: string[], snapshot: TasteSnapshot): number {
  const weights = snapshot.genreWeights
  if (weights.size === 0) return 0.5 // no history — stay neutral, let ratings decide
  const matched = genres.reduce((acc, g) => acc + (weights.get(normGenre(g)) ?? 0), 0)
  const topTwo = [...weights.values()].sort((x, y) => y - x).slice(0, 2)
  const norm = Math.max(0.5, topTwo.reduce((x, y) => x + y, 0))
  return Math.min(1, matched / norm)
}

export interface PairScore {
  /** honest 0–100 labels for each person */
  forA: number
  forB: number
  /** raw sort key — least-misery blend, higher is better */
  joint: number
}

export function scoreTitleForPair(
  input: { genres: string[]; voteAverage: number },
  a: TasteSnapshot,
  b: TasteSnapshot,
): PairScore {
  const ratingPrior = input.voteAverage > 0 ? input.voteAverage / 10 : 0.55
  const personal = (fit: number) => fit * 0.72 + ratingPrior * 0.28
  const rawA = personal(genreFitFor(input.genres, a))
  const rawB = personal(genreFitFor(input.genres, b))
  // the couple rule: the pick must clear the bar for BOTH — min dominates
  const joint = Math.min(rawA, rawB) * 0.8 + ((rawA + rawB) / 2) * 0.2
  return {
    forA: Math.round(Math.min(0.99, rawA) * 100),
    forB: Math.round(Math.min(0.99, rawB) * 100),
    joint,
  }
}
