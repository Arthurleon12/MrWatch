import { describe, expect, it } from 'vitest'
import { buildTasteSnapshot, computeTasteMatch, genreFitFor, normGenre, scoreTitleForPair } from './match'
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
