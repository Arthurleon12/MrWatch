import type { TvmShow } from '../types'
import type { Top10Show } from '../store/profile'

/**
 * Taste-based recommendation scoring.
 *
 * A user's taste profile is built from the shows they track, weighted by
 * real engagement: how many episodes they've actually watched, and where
 * the show sits on their ladder. Candidates are scored by genre overlap
 * against that profile, with a network-affinity bonus and a public-rating
 * prior. Every pick carries attribution ("because you watch …") so the
 * feed never feels like a black box.
 */

export interface TasteProfile {
  /** genre → weight, normalized so the max genre is 1 */
  genres: Map<string, number>
  /** network/webChannel name → weight, normalized to max 1 */
  networks: Map<string, number>
  /** tracked shows with their genres, for "because you watch X" attribution */
  seeds: { id: number; name: string; genres: string[]; weight: number }[]
  /** languages the user demonstrably watches */
  languages: Set<string>
}

export interface ScoredShow {
  show: TvmShow & { rating?: { average: number | null } }
  /** 0–100, honest label for genre+network fit */
  match: number
  /** e.g. "Because you watch Slow Horses" or "Drama · Thriller" */
  because: string
}

interface EngagementInputs {
  details: TvmShow[]
  /** watched episode ids per show id */
  watched: Record<number, number[]>
  ladder: Top10Show[]
}

export function buildTasteProfile({ details, watched, ladder }: EngagementInputs): TasteProfile {
  const genres = new Map<string, number>()
  const networks = new Map<string, number>()
  const seeds: TasteProfile['seeds'] = []
  const languages = new Set<string>()

  for (const show of details) {
    if (show.language) languages.add(show.language)
    const watchedCount = watched[show.id]?.length ?? 0
    const ladderIndex = ladder.findIndex((l) => l.id === show.id)
    // tracking alone counts for 1; deep watching and a high ladder spot count for more
    const weight =
      1 + Math.log2(1 + watchedCount) + (ladderIndex >= 0 ? (10 - ladderIndex) / 3 : 0)

    seeds.push({ id: show.id, name: show.name, genres: show.genres, weight })
    for (const g of show.genres) genres.set(g, (genres.get(g) ?? 0) + weight)
    const net = show.network?.name ?? show.webChannel?.name
    if (net) networks.set(net, (networks.get(net) ?? 0) + weight)
  }

  const maxG = Math.max(1, ...genres.values())
  for (const [k, v] of genres) genres.set(k, v / maxG)
  const maxN = Math.max(1, ...networks.values())
  for (const [k, v] of networks) networks.set(k, v / maxN)

  seeds.sort((a, b) => b.weight - a.weight)
  return { genres, networks, seeds, languages }
}

export function scoreShow(candidate: TvmShow, profile: TasteProfile): ScoredShow {
  // Genre fit: SUM of matched profile weights, normalized against the
  // profile's two strongest genres. Summing (not averaging) means a show
  // matching Drama AND Thriller beats a single-genre Drama soap.
  const matchedSum = candidate.genres.reduce((acc, g) => acc + (profile.genres.get(g) ?? 0), 0)
  const topTwo = [...profile.genres.values()].sort((a, b) => b - a).slice(0, 2)
  const norm = Math.max(1, topTwo.reduce((a, b) => a + b, 0))
  const genreFit = Math.min(1, matchedSum / norm)

  const net = candidate.network?.name ?? candidate.webChannel?.name
  const networkFit = net ? (profile.networks.get(net) ?? 0) : 0

  const rating = candidate.rating?.average ?? null
  const ratingPrior = rating ? rating / 10 : 0.5
  const popularity = (candidate.weight ?? 50) / 100

  let score = genreFit * 0.6 + networkFit * 0.1 + ratingPrior * 0.2 + popularity * 0.1

  // Long-running daily soaps ride the schedule every single day; dampen
  // anything still running after 15+ years so they can't squat the feed.
  const premieredYear = candidate.premiered ? Number(candidate.premiered.slice(0, 4)) : null
  if (premieredYear && candidate.status === 'Running' && new Date().getFullYear() - premieredYear >= 15) {
    score *= 0.72
  }

  // languages you've never watched are a long shot — dampen, don't exclude
  if (profile.languages.size > 0 && candidate.language && !profile.languages.has(candidate.language)) {
    score *= 0.55
  }

  const match = Math.round(Math.min(0.99, score) * 100)

  // attribution: the seed show sharing the most genre weight, else top genres
  let bestSeed: { name: string; overlap: number } | null = null
  for (const seed of profile.seeds) {
    const overlap = seed.genres.filter((g) => candidate.genres.includes(g)).length * seed.weight
    if (overlap > 0 && (!bestSeed || overlap > bestSeed.overlap)) {
      bestSeed = { name: seed.name, overlap }
    }
  }
  const because = bestSeed
    ? `Because you watch ${bestSeed.name}`
    : candidate.genres.slice(0, 2).join(' · ') || 'Popular now'

  return { show: candidate, match, because }
}

/** Formats that don't belong in a scripted-taste feed. */
export const EXCLUDED_TYPES = new Set([
  'News',
  'Sports',
  'Talk Show',
  'Game Show',
  'Award Show',
  'Panel Show',
  'Variety',
  'Reality',
])

export function rankCandidates(
  candidates: TvmShow[],
  profile: TasteProfile,
  excludeIds: Set<number>,
  limit: number,
): ScoredShow[] {
  const seen = new Set<number>()
  const scored: ScoredShow[] = []
  for (const c of candidates) {
    if (excludeIds.has(c.id) || seen.has(c.id)) continue
    if (!c.image || !c.summary) continue // never recommend a show we can't present
    if (c.type && EXCLUDED_TYPES.has(c.type)) continue
    seen.add(c.id)
    scored.push(scoreShow(c, profile))
  }
  return scored.sort((a, b) => b.match - a.match).slice(0, limit)
}
