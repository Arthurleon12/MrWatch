/**
 * Episode ratings (1–10, one decimal) as a taste signal.
 *
 * Tracking a show says you gave it a chance; rating its episodes says what you
 * actually thought of it. Without this, hate-watching a show recommends more
 * of the same — the engine can't tell a 9.5 from a 3.
 *
 * A show's rating is the mean of its rated episodes, and its influence is
 * shrunk toward neutral when it rests on only one or two ratings.
 */

export interface ShowRating {
  /** mean of this show's rated episodes, 1–10 */
  avg: number
  /** how many episodes carry a rating — our confidence in `avg` */
  count: number
}

/** The score at which a show is neither liked nor disliked. */
export const NEUTRAL_RATING = 7

/** Rating span, either side of neutral, that reaches full effect. */
const FULL_SWING_POINTS = 3

/** Ratings resting on few episodes are pulled back toward neutral. */
const CONFIDENCE_K = 3

/** How far a rating can move a show's taste weight, either way. */
const MAX_EFFECT = 0.7

/** Per-show rating averages, from the library's watched + ratings maps. */
export function showRatings(
  watched: Record<number, number[]>,
  ratings: Record<number, number>,
): Map<number, ShowRating> {
  const out = new Map<number, ShowRating>()
  for (const [showId, episodeIds] of Object.entries(watched)) {
    let sum = 0
    let count = 0
    for (const episodeId of episodeIds) {
      const rating = ratings[episodeId]
      if (rating != null) {
        sum += rating
        count++
      }
    }
    if (count > 0) out.set(Number(showId), { avg: sum / count, count })
  }
  return out
}

/**
 * Multiplier on a show's taste weight: ~1.7 for a show you rate 10s, ~0.3 for
 * one you rate 4s, exactly 1 when you haven't rated it at all. Stays positive
 * — a disliked show fades out of your profile rather than flipping sign, which
 * would make cosine similarity (and every percentage built on it) meaningless.
 */
export function affinityMultiplier(rating: ShowRating | undefined): number {
  if (!rating || rating.count === 0) return 1
  // a corrupt average must not poison every weight (and percentage) built on it
  if (!Number.isFinite(rating.avg) || !Number.isFinite(rating.count) || rating.count < 0) return 1
  const signed = clamp((rating.avg - NEUTRAL_RATING) / FULL_SWING_POINTS, -1, 1)
  const confidence = rating.count / (rating.count + CONFIDENCE_K)
  return 1 + MAX_EFFECT * signed * confidence
}

export interface RatingAgreement {
  showId: number
  mine: number
  theirs: number
}

/**
 * How closely two people's ratings line up on the shows they've both rated.
 * `score` is 0–1 (null when they overlap on nothing), where a full 10-point
 * disagreement scores 0 and identical scores 1.
 */
export function ratingAgreement(
  a: Map<number, ShowRating>,
  b: Map<number, ShowRating>,
): { shared: RatingAgreement[]; score: number | null } {
  const shared: RatingAgreement[] = []
  for (const [showId, mine] of a) {
    const theirs = b.get(showId)
    if (theirs) shared.push({ showId, mine: mine.avg, theirs: theirs.avg })
  }
  if (shared.length === 0) return { shared, score: null }
  const meanGap =
    shared.reduce((acc, s) => acc + Math.abs(s.mine - s.theirs), 0) / shared.length
  return { shared, score: clamp(1 - meanGap / 9, 0, 1) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
