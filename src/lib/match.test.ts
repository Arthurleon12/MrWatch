import { describe, expect, it } from 'vitest'
import {
  buildTasteSnapshot,
  computeTasteMatch,
  genreFitFor,
  normGenre,
  overlapScore,
  scoreTitleForPair,
  tasteDetailIds,
} from './match'
import type { ShowRating } from './ratings'
import { makeShow } from '../test/fixtures'

const drama = makeShow({ id: 1, name: 'Severance', genres: ['Drama', 'Science-Fiction'] })
const comedy = makeShow({ id: 2, name: 'Sitcom', genres: ['Comedy'] })

function snapshot(opts: {
  username: string
  shows?: typeof drama[]
  watchedCounts?: Record<number, number>
  ratings?: Record<number, ShowRating>
  movies?: { id: number; title: string; genres: string[]; status: 'want' | 'watched' }[]
}) {
  const shows = opts.shows ?? []
  return buildTasteSnapshot({
    username: opts.username,
    tracked: shows.map((s) => ({ id: s.id, name: s.name, image: null })),
    showDetails: shows,
    watchedCounts: opts.watchedCounts ?? {},
    ladderShows: [],
    ladderMovies: [],
    showRatings: new Map(Object.entries(opts.ratings ?? {}).map(([id, r]) => [Number(id), r])),
    movies: (opts.movies ?? []).map((m) => ({ ...m, poster: null })),
  })
}

describe('normGenre', () => {
  it('bridges the two catalogues so TV taste transfers to film', () => {
    expect(normGenre('Science-Fiction')).toBe(normGenre('Science Fiction'))
    expect(normGenre('Anime')).toBe(normGenre('Animation'))
  })

  it('folds the genres only TVmaze has into their nearest film genre', () => {
    const pairs: [string, string][] = [
      ['Children', 'Family'],
      ['Supernatural', 'Fantasy'],
      ['Espionage', 'Thriller'],
      ['Legal', 'Drama'],
      ['Medical', 'Drama'],
      ['Sci-Fi', 'Science Fiction'],
    ]
    for (const [tv, film] of pairs) expect(normGenre(tv)).toBe(normGenre(film))
  })

  it('leaves shared genres alone and distinct genres distinct', () => {
    expect(normGenre('Drama')).toBe('drama')
    expect(normGenre('  Science-Fiction ')).toBe('science fiction')
    expect(normGenre('Comedy')).not.toBe(normGenre('Drama'))
  })
})

describe('computeTasteMatch', () => {
  it('scores two identical histories far above two opposite ones', () => {
    const a = snapshot({ username: 'a', shows: [drama] })
    const twin = snapshot({ username: 'b', shows: [drama] })
    const opposite = snapshot({ username: 'c', shows: [comedy] })
    expect(computeTasteMatch(a, twin).percent).toBeGreaterThan(
      computeTasteMatch(a, opposite).percent,
    )
  })

  it('holds back the score until there is enough history to mean anything', () => {
    const thin = snapshot({ username: 'a', shows: [drama] })
    expect(computeTasteMatch(thin, thin).hasEnoughData).toBe(false)
    const solid = snapshot({ username: 'a', shows: [drama, comedy] })
    expect(computeTasteMatch(solid, solid).hasEnoughData).toBe(true)
  })

  it('separates two people who watch the same shows but disagree about them', () => {
    const shows = [drama, comedy]
    const me = snapshot({ username: 'me', shows, ratings: { 1: { avg: 9.4, count: 8 } } })
    const agrees = snapshot({ username: 'agrees', shows, ratings: { 1: { avg: 9.1, count: 6 } } })
    const disagrees = snapshot({ username: 'disagrees', shows, ratings: { 1: { avg: 2.5, count: 6 } } })

    // same shared shows and genres on both sides — only the verdicts differ
    expect(computeTasteMatch(me, agrees).percent).toBeGreaterThan(
      computeTasteMatch(me, disagrees).percent,
    )
  })

  it('names the show they both rated, closest agreement first', () => {
    const shows = [drama, comedy]
    const me = snapshot({
      username: 'me',
      shows,
      ratings: { 1: { avg: 9, count: 3 }, 2: { avg: 5, count: 3 } },
    })
    const them = snapshot({
      username: 'them',
      shows,
      ratings: { 1: { avg: 9.2, count: 3 }, 2: { avg: 9, count: 3 } },
    })
    const match = computeTasteMatch(me, them)
    expect(match.ratingAgreements[0]).toEqual({ name: 'Severance', mine: 9, theirs: 9.2 })
  })

  it('reports what the two actually share', () => {
    const me = snapshot({ username: 'me', shows: [drama, comedy] })
    const them = snapshot({ username: 'them', shows: [drama] })
    const match = computeTasteMatch(me, them)
    expect(match.sharedShows.map((s) => s.name)).toEqual(['Severance'])
    expect(match.percent).toBeGreaterThanOrEqual(0)
    expect(match.percent).toBeLessThanOrEqual(100)
  })

  it('survives two empty histories without dividing by zero', () => {
    const empty = snapshot({ username: 'nobody' })
    const match = computeTasteMatch(empty, empty)
    expect(match.percent).toBe(0)
    expect(match.hasEnoughData).toBe(false)
  })
})

describe('genreFitFor', () => {
  it('stays neutral for someone with no history', () => {
    expect(genreFitFor(['Drama'], snapshot({ username: 'new' }))).toBe(0.5)
  })

  it('rates a match above a miss', () => {
    const me = snapshot({ username: 'me', shows: [drama] })
    expect(genreFitFor(['Drama'], me)).toBeGreaterThan(genreFitFor(['Reality'], me))
  })
})

describe('scoreTitleForPair', () => {
  const sciFiFan = snapshot({ username: 'a', shows: [drama] })
  const comedyFan = snapshot({ username: 'b', shows: [comedy] })

  it('will not pick a film only one of them would enjoy', () => {
    const oneSided = scoreTitleForPair({ genres: ['Science Fiction'], voteAverage: 8 }, sciFiFan, comedyFan)
    const bothOk = scoreTitleForPair({ genres: ['Comedy', 'Drama'], voteAverage: 8 }, sciFiFan, comedyFan)
    expect(bothOk.joint).toBeGreaterThan(oneSided.joint)
  })

  it('reports an honest per-person percentage', () => {
    const score = scoreTitleForPair({ genres: ['Science Fiction'], voteAverage: 9 }, sciFiFan, comedyFan)
    expect(score.forA).toBeGreaterThan(score.forB)
    for (const value of [score.forA, score.forB]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(99)
    }
  })
})

describe('tasteDetailIds', () => {
  // newest first, the way the hooks hand them over; ids 31–40 are the oldest
  const tracked = Array.from({ length: 40 }, (_, i) => ({ id: i + 1 }))

  it('keeps ladder shows when the library is bigger than the budget', () => {
    const ladder = [{ id: 40 }, { id: 35 }, { id: 31 }]
    const ids = tasteDetailIds(tracked, ladder, {}, 30)
    expect(ids).toHaveLength(30)
    expect(ids.slice(0, 3)).toEqual([40, 35, 31]) // ladder order
  })

  it('then prefers the most-watched, then the most recent', () => {
    const ids = tasteDetailIds(tracked, [], { 39: 80, 38: 120 }, 4)
    expect(ids).toEqual([38, 39, 1, 2])
  })

  it('returns everything, once, when the library fits', () => {
    const few = [{ id: 3 }, { id: 2 }, { id: 1 }]
    expect(tasteDetailIds(few, [{ id: 1 }, { id: 99 }], {}, 30)).toEqual([1, 3, 2])
  })

  it('does not let an oversized ladder reorder past its tenth rung', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i }))
    const ids = tasteDetailIds(tracked, [...long, { id: 40 }], {}, 3)
    expect(ids).toEqual([1, 2, 3])
  })

  it('changes the taste profile it feeds', () => {
    // ten old horror favourites on the ladder, thirty recent comedies
    const horror = tracked.slice(30).map((t) => makeShow({ id: t.id, name: `H${t.id}`, genres: ['Horror'] }))
    const comedies = tracked.slice(0, 30).map((t) => makeShow({ id: t.id, name: `C${t.id}`, genres: ['Comedy'] }))
    const byId = new Map([...horror, ...comedies].map((s) => [s.id, s]))
    const ladder = horror.map((s) => ({ id: s.id, name: s.name, image: null }))
    const ids = tasteDetailIds(tracked, ladder, {}, 30)
    const me = buildTasteSnapshot({
      username: 'me',
      tracked: tracked.map((t) => ({ id: t.id, name: byId.get(t.id)!.name, image: null })),
      showDetails: ids.map((id) => byId.get(id)!),
      watchedCounts: {},
      ladderShows: ladder,
      ladderMovies: [],
      movies: [],
    })
    expect(me.genreWeights.get('horror')).toBe(1)
    expect(genreFitFor(['Horror'], me)).toBeGreaterThan(0.5)
  })
})

describe('data that arrives malformed', () => {
  const rung = (id: number) => ({ id, name: `Show ${id}`, image: null })
  const pad = Array.from({ length: 25 }, (_, i) => rung(1000 + i))

  /** A friend whose ladder JSON holds 26 entries, their tracked show last. */
  const oversized = buildTasteSnapshot({
    username: 'friend',
    tracked: [rung(1), rung(2)],
    showDetails: [drama, comedy],
    watchedCounts: {},
    ladderShows: [...pad, rung(1)],
    ladderMovies: [],
    movies: [],
  })
  const me = buildTasteSnapshot({
    username: 'me',
    tracked: [rung(1), rung(2)],
    showDetails: [drama, comedy],
    watchedCounts: {},
    ladderShows: [rung(1)],
    ladderMovies: [],
    movies: [],
  })

  it('never lets a ladder longer than ten turn a genre weight negative', () => {
    for (const weight of oversized.genreWeights.values()) {
      expect(weight).toBeGreaterThanOrEqual(0)
      expect(weight).toBeLessThanOrEqual(1)
    }
  })

  it('still reports a real percentage', () => {
    const match = computeTasteMatch(me, oversized)
    expect(Number.isFinite(match.percent)).toBe(true)
    expect(match.percent).toBeGreaterThanOrEqual(0)
    expect(match.percent).toBeLessThanOrEqual(100)
  })

  it('floors a ladder disagreement wider than the ladder at zero, not below', () => {
    const a = buildTasteSnapshot({
      username: 'a', tracked: [], showDetails: [], watchedCounts: {},
      ladderShows: [rung(99)], ladderMovies: [], movies: [],
    })
    const b = buildTasteSnapshot({
      username: 'b', tracked: [], showDetails: [], watchedCounts: {},
      ladderShows: [...pad, rung(99)], ladderMovies: [], movies: [],
    })
    expect(computeTasteMatch(a, b).percent).toBe(0)
  })

  it('keeps per-person labels inside 0–99', () => {
    const score = scoreTitleForPair({ genres: ['Drama'], voteAverage: 8 }, me, oversized)
    for (const value of [score.forA, score.forB]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(99)
    }
    expect(Number.isFinite(score.joint)).toBe(true)
  })

  it('falls back to the prior when a title has no usable vote average', () => {
    for (const voteAverage of [NaN, 0, undefined as unknown as number]) {
      const score = scoreTitleForPair({ genres: ['Drama'], voteAverage }, me, oversized)
      expect(Number.isFinite(score.joint)).toBe(true)
    }
  })
})

describe('invariants over many histories', () => {
  const GENRES = ['Drama', 'Comedy', 'Science-Fiction', 'Anime', 'Children', 'Horror', 'Supernatural']
  // small deterministic generator — a failure must be reproducible
  let seed = 42
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const pick = (n: number) => Math.floor(rand() * n)

  function randomSnapshot(name: string) {
    const shows = Array.from({ length: pick(6) }, () => {
      const id = 1 + pick(12)
      return makeShow({ id, name: `Show ${id}`, genres: GENRES.filter(() => rand() < 0.35) })
    }).filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i)
    const ratings = new Map<number, ShowRating>()
    for (const s of shows) if (rand() < 0.5) ratings.set(s.id, { avg: 1 + rand() * 9, count: 1 + pick(20) })
    return buildTasteSnapshot({
      username: name,
      tracked: shows.map((s) => ({ id: s.id, name: s.name, image: null })),
      showDetails: shows.filter(() => rand() < 0.8),
      watchedCounts: Object.fromEntries(shows.map((s) => [s.id, pick(200)])),
      ladderShows: shows.filter(() => rand() < 0.4).map((s) => ({ id: s.id, name: s.name, image: null })),
      ladderMovies: [],
      showRatings: ratings,
      movies: Array.from({ length: pick(4) }, (_, i) => ({
        id: 500 + pick(6) + i * 10,
        title: 'Film',
        poster: null,
        genres: ['Family', 'Fantasy', 'Science Fiction', 'Animation'].filter(() => rand() < 0.4),
        status: rand() < 0.7 ? ('watched' as const) : ('want' as const),
      })),
    })
  }

  it('always yields finite, bounded, symmetric percentages', () => {
    for (let i = 0; i < 300; i++) {
      const a = randomSnapshot('a')
      const b = randomSnapshot('b')
      const ab = computeTasteMatch(a, b).percent
      expect(Number.isInteger(ab)).toBe(true)
      expect(ab).toBeGreaterThanOrEqual(0)
      expect(ab).toBeLessThanOrEqual(100)
      expect(computeTasteMatch(b, a).percent).toBe(ab)

      const score = scoreTitleForPair(
        { genres: GENRES.filter(() => rand() < 0.4), voteAverage: rand() * 10 },
        a,
        b,
      )
      for (const value of [score.forA, score.forB]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(99)
      }
      expect(Number.isFinite(score.joint)).toBe(true)
    }
  })

  it('caps the fit at 1 when a title repeats a genre under two names', () => {
    const fan = buildTasteSnapshot({
      username: 'fan',
      tracked: [{ id: 1, name: 'Anime', image: null }],
      showDetails: [makeShow({ id: 1, name: 'Anime', genres: ['Anime'] })],
      watchedCounts: {},
      ladderShows: [],
      ladderMovies: [],
      movies: [],
    })
    expect(genreFitFor(['Anime', 'Animation'], fan)).toBe(1)
    expect(genreFitFor(['Family', 'Children'], fan)).toBe(0)
  })
})

describe('overlap between uneven libraries', () => {
  it('does not call two shared shows a perfect match', () => {
    expect(overlapScore(2, 200, 2)).toBeCloseTo(0.4)
    expect(overlapScore(5, 200, 5)).toBe(1)
    expect(overlapScore(10, 200, 20)).toBe(0.5)
  })

  it('is symmetric and safe on empty libraries', () => {
    expect(overlapScore(2, 2, 200)).toBe(overlapScore(2, 200, 2))
    expect(overlapScore(0, 0, 10)).toBe(0)
    expect(overlapScore(9, 3, 3)).toBe(0.6) // never above the confidence cap
  })

  it('a completist and someone with two shows are not a 100% match', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      makeShow({ id: i + 1, name: `Show ${i + 1}`, genres: ['Drama'] }),
    )
    const big = snapshot({ username: 'completist', shows: many })
    const small = snapshot({ username: 'newcomer', shows: many.slice(0, 2) })
    const match = computeTasteMatch(big, small)
    expect(match.percent).toBeLessThan(100)
    expect(match.percent).toBe(computeTasteMatch(small, big).percent)

    // …while two people who genuinely share a real shelf still score full marks
    const peer = snapshot({ username: 'peer', shows: many.slice(0, 20) })
    const twin = snapshot({ username: 'twin', shows: many.slice(0, 20) })
    expect(computeTasteMatch(peer, twin).percent).toBe(100)
  })
})
