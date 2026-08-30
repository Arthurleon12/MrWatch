import { describe, expect, it } from 'vitest'
import { buildTasteProfile, rankCandidates, scoreShow } from './recommend'
import { makeShow } from '../test/fixtures'

const thriller = makeShow({ id: 1, name: 'Slow Horses', genres: ['Drama', 'Thriller'] })
const comedy = makeShow({ id: 2, name: 'Sitcom', genres: ['Comedy'] })

describe('buildTasteProfile', () => {
  it('weights a show you have watched deeply over one you only track', () => {
    const profile = buildTasteProfile({
      details: [thriller, comedy],
      watched: { 1: Array.from({ length: 60 }, (_, i) => i) },
      ladder: [],
    })
    expect(profile.genres.get('Thriller')!).toBeGreaterThan(profile.genres.get('Comedy')!)
  })

  it('weights a show on your ladder over one that is not', () => {
    const profile = buildTasteProfile({
      details: [thriller, comedy],
      watched: {},
      ladder: [{ id: 1, name: 'Slow Horses', image: null }],
    })
    expect(profile.genres.get('Thriller')!).toBeGreaterThan(profile.genres.get('Comedy')!)
  })

  it('lets your ratings outweigh equal viewing', () => {
    const equalViewing = { 1: [10, 11, 12], 2: [20, 21, 22] }
    const flat = buildTasteProfile({ details: [thriller, comedy], watched: equalViewing, ladder: [] })
    // same episodes watched either way, so without ratings the two genres tie
    expect(flat.genres.get('Thriller')).toBeCloseTo(flat.genres.get('Comedy')!)

    const rated = buildTasteProfile({
      details: [thriller, comedy],
      watched: equalViewing,
      ladder: [],
      ratings: new Map([
        [1, { avg: 9.5, count: 3 }],
        [2, { avg: 3, count: 3 }],
      ]),
    })
    expect(rated.genres.get('Thriller')!).toBeGreaterThan(rated.genres.get('Comedy')!)
  })

  it('records the languages you actually watch', () => {
    const profile = buildTasteProfile({
      details: [makeShow({ id: 3, name: 'Anime', language: 'Japanese', genres: ['Anime'] })],
      watched: {},
      ladder: [],
    })
    expect([...profile.languages]).toEqual(['Japanese'])
  })
})

describe('scoreShow', () => {
  const profile = buildTasteProfile({
    details: [thriller],
    watched: { 1: Array.from({ length: 40 }, (_, i) => i) },
    ladder: [],
  })

  it('scores a genre match above an unrelated show', () => {
    const match = scoreShow(makeShow({ id: 10, name: 'New Spy Drama', genres: ['Drama', 'Thriller'] }), profile)
    const miss = scoreShow(makeShow({ id: 11, name: 'Bake Off', genres: ['Food'] }), profile)
    expect(match.match).toBeGreaterThan(miss.match)
  })

  it('dampens a soap that has been running for fifteen years', () => {
    const base = { name: 'Serial', genres: ['Drama'], status: 'Running' }
    const fresh = scoreShow(makeShow({ ...base, id: 12, premiered: '2024-01-01' }), profile)
    const soap = scoreShow(makeShow({ ...base, id: 13, premiered: '1985-01-01' }), profile)
    expect(soap.match).toBeLessThan(fresh.match)
  })

  it('dampens a language you have never watched', () => {
    const english = scoreShow(makeShow({ id: 14, name: 'A', genres: ['Drama'], language: 'English' }), profile)
    const other = scoreShow(makeShow({ id: 15, name: 'B', genres: ['Drama'], language: 'Danish' }), profile)
    expect(other.match).toBeLessThan(english.match)
  })

  it('credits the show that earned the recommendation', () => {
    const scored = scoreShow(makeShow({ id: 16, name: 'New', genres: ['Thriller'] }), profile)
    expect(scored.because).toBe('Because you watch Slow Horses')
  })

  it('credits your score when you rated the seed highly', () => {
    const rated = buildTasteProfile({
      details: [thriller],
      watched: { 1: [1, 2, 3] },
      ladder: [],
      ratings: new Map([[1, { avg: 9.2, count: 3 }]]),
    })
    const scored = scoreShow(makeShow({ id: 17, name: 'New', genres: ['Thriller'] }), rated)
    expect(scored.because).toBe('Because you rated Slow Horses 9.2')
  })

  it('falls back to genres when nothing in your taste explains the pick', () => {
    const empty = buildTasteProfile({ details: [], watched: {}, ladder: [] })
    const scored = scoreShow(makeShow({ id: 18, name: 'New', genres: ['Drama', 'Family'] }), empty)
    expect(scored.because).toBe('Drama · Family')
  })
})

describe('rankCandidates', () => {
  const profile = buildTasteProfile({ details: [thriller], watched: { 1: [1, 2] }, ladder: [] })

  it('never recommends something you already track', () => {
    const candidates = [makeShow({ id: 1, name: 'Slow Horses', genres: ['Thriller'] })]
    expect(rankCandidates(candidates, profile, new Set([1]), 10)).toHaveLength(0)
  })

  it('skips shows it cannot present', () => {
    const candidates = [
      makeShow({ id: 20, name: 'No Poster', genres: ['Drama'], image: null }),
      makeShow({ id: 21, name: 'No Blurb', genres: ['Drama'], summary: null }),
    ]
    expect(rankCandidates(candidates, profile, new Set(), 10)).toHaveLength(0)
  })

  it('keeps non-scripted formats out of a scripted feed', () => {
    const candidates = [makeShow({ id: 22, name: 'The News', genres: ['Drama'], type: 'News' })]
    expect(rankCandidates(candidates, profile, new Set(), 10)).toHaveLength(0)
  })

  it('deduplicates, sorts by match and honours the limit', () => {
    const candidates = [
      makeShow({ id: 30, name: 'Weak', genres: ['Food'] }),
      makeShow({ id: 31, name: 'Strong', genres: ['Drama', 'Thriller'] }),
      makeShow({ id: 31, name: 'Strong again', genres: ['Drama', 'Thriller'] }),
    ]
    const ranked = rankCandidates(candidates, profile, new Set(), 2)
    expect(ranked.map((r) => r.show.id)).toEqual([31, 30])
  })
})
