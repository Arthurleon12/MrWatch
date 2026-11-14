import type { TvmShow } from '../types'
import type { Top10Show } from '../store/profile'
import { affinityMultiplier, ratingAgreement, type ShowRating } from './ratings'
import { ladderBonus } from './recommend'

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
//
// TVmaze also has genres TMDB's movie vocabulary lacks entirely; fold each
// into the film genre it sits closest to, or that taste never reaches a movie.
const GENRE_ALIAS: Record<string, string> = {
  anime: 'animation',
  children: 'family',
  supernatural: 'fantasy',
  espionage: 'thriller',
  legal: 'drama',
  medical: 'drama',
  'sci fi': 'science fiction',
}

export function normGenre(genre: string): string {
  const key = genre.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
  return GENRE_ALIAS[key] ?? key
}

/**
 * Which tracked shows to fetch genres for when the library is bigger than the
 * detail budget. Ladder shows first (in ladder order), then the most-watched:
 * those carry the most taste weight, so they are the last ones to leave out.
 * Recency alone would drop an all-time favourite added years ago.
 */
export function tasteDetailIds(
  tracked: { id: number }[],
  ladder: { id: number }[],
  watchedCounts: Record<number, number>,
  cap: number,
): number[] {
  const rank = new Map<number, number>()
  ladder.slice(0, 10).forEach((l, i) => {
    if (!rank.has(l.id)) rank.set(l.id, i)
  })
  const offLadder = Number.MAX_SAFE_INTEGER
  return [...tracked]
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? offLadder) - (rank.get(b.id) ?? offLadder) ||
        (watchedCounts[b.id] ?? 0) - (watchedCounts[a.id] ?? 0),
    )
    .slice(0, cap)
    .map((s) => s.id)
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
  /** show id → what this person scored that show's episodes */
  showRatings: Map<number, ShowRating>
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
  /** show id → episode-rating average, when this person rates episodes */
  showRatings?: Map<number, ShowRating>
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
    // same engagement weighting as the solo recommendation engine, ratings included
    const weight =
      (1 + Math.log2(1 + watchedCount) + ladderBonus(ladderIndex)) *
      affinityMultiplier(input.showRatings?.get(t.id))
    for (const g of detailById.get(t.id)?.genres ?? []) add(g, weight)
  }

  for (const m of input.movies) {
    const ladderIndex = input.ladderMovies.findIndex((l) => l.id === m.id)
    const weight = m.status === 'watched' ? 1 + ladderBonus(ladderIndex) : 0.4
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
    showRatings: input.showRatings ?? new Map(),
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
  /** shows both people have rated, with each side's average */
  ratingAgreements: { name: string; mine: number; theirs: number }[]
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

/** A library this size is enough for its overlap with another to mean something. */
const FULL_CONFIDENCE_SIZE = 5

/**
 * How much of the smaller library the other person shares, 0..1 — discounted
 * when the smaller library is tiny. Dividing by the smaller side is what lets
 * a casual viewer match a completist, but on its own it calls someone with
 * two shows a perfect match for anyone who happens to have both.
 */
export function overlapScore(shared: number, sizeA: number, sizeB: number): number {
  const smaller = Math.min(sizeA, sizeB)
  if (smaller <= 0) return 0
  const confidence = Math.min(1, smaller / FULL_CONFIDENCE_SIZE)
  return Math.min(1, shared / smaller) * confidence
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

  // shows both have rated: the sharpest signal we have, because it compares
  // opinions rather than exposure — two people can watch the same show and
  // disagree completely about it
  const agreement = ratingAgreement(a.showRatings, b.showRatings)
  const nameById = new Map<number, string>()
  for (const s of [...a.trackedShows, ...b.trackedShows]) nameById.set(s.id, s.name)
  const ratingAgreements = agreement.shared
    .map((r) => ({ name: nameById.get(r.showId) ?? '', mine: r.mine, theirs: r.theirs }))
    .filter((r) => r.name)
    .sort((x, y) => Math.abs(x.mine - x.theirs) - Math.abs(y.mine - y.theirs))

  // components, each 0..1, skipped when either side lacks the data
  const parts: { weight: number; value: number }[] = []

  if (a.genreWeights.size > 0 && b.genreWeights.size > 0) {
    // cosine runs hot (everyone likes Drama) — a gentle power spreads it out
    // (clamped first: a negative base to a fractional power is NaN)
    const similarity = Math.min(1, Math.max(0, cosine(a.genreWeights, b.genreWeights)))
    parts.push({ weight: 0.45, value: Math.pow(similarity, 1.25) })
  }
  if (a.trackedShows.length > 0 && b.trackedShows.length > 0) {
    parts.push({
      weight: 0.3,
      value: overlapScore(sharedShows.length, a.trackedShows.length, b.trackedShows.length),
    })
  }
  if (a.watchedMovies.length > 0 && b.watchedMovies.length > 0) {
    parts.push({
      weight: 0.15,
      value: overlapScore(sharedMovies.length, a.watchedMovies.length, b.watchedMovies.length),
    })
  }
  if (ladderAgreements.length > 0) {
    const closeness =
      ladderAgreements.reduce(
        (acc, l) => acc + Math.max(0, 1 - Math.abs(l.rankA - l.rankB) / 10),
        0,
      ) /
      ladderAgreements.length
    parts.push({ weight: 0.1, value: closeness })
  }
  if (agreement.score !== null) {
    // weighted like the genre component: agreeing on shows you've both scored
    // says more than sharing a genre, so it carries real weight once it exists
    parts.push({ weight: 0.25, value: agreement.score })
  }

  const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0)
  const rawPercent =
    totalWeight > 0
      ? Math.round((parts.reduce((acc, p) => acc + p.weight * p.value, 0) / totalWeight) * 100)
      : 0
  // whatever reached us from the network, the label stays a real percentage
  const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 0

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
    ratingAgreements,
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
    forA: Math.round(Math.min(0.99, Math.max(0, rawA)) * 100),
    forB: Math.round(Math.min(0.99, Math.max(0, rawB)) * 100),
    joint,
  }
}
