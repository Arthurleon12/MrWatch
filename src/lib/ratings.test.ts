import { describe, expect, it } from 'vitest'
import { affinityMultiplier, ratingAgreement, showRatings } from './ratings'

describe('showRatings', () => {
  it('averages only the episodes that carry a rating', () => {
    const map = showRatings({ 1: [10, 11, 12] }, { 10: 9, 12: 7 })
    expect(map.get(1)).toEqual({ avg: 8, count: 2 })
  })

  it('leaves out shows with no rated episodes', () => {
    const map = showRatings({ 1: [10], 2: [20] }, { 10: 8 })
    expect(map.has(2)).toBe(false)
  })

  it('ignores ratings for episodes that are no longer watched', () => {
    // an unwatched episode's rating is cleared by the store, but a stale entry
    // must never leak into taste either way
    const map = showRatings({ 1: [10] }, { 10: 8, 99: 1 })
    expect(map.get(1)).toEqual({ avg: 8, count: 1 })
  })
})

describe('affinityMultiplier', () => {
  it('is neutral for a show you have not rated', () => {
    expect(affinityMultiplier(undefined)).toBe(1)
    expect(affinityMultiplier({ avg: 0, count: 0 })).toBe(1)
  })

  it('stays neutral when the average is not a usable number', () => {
    expect(affinityMultiplier({ avg: NaN, count: 2 })).toBe(1)
    expect(affinityMultiplier({ avg: Infinity, count: 2 })).toBe(1)
    expect(affinityMultiplier({ avg: 9, count: NaN })).toBe(1)
    expect(affinityMultiplier({ avg: 9, count: -4 })).toBe(1)
  })

  it('is neutral at the neutral score however many ratings back it', () => {
    expect(affinityMultiplier({ avg: 7, count: 50 })).toBeCloseTo(1)
  })

  it('lifts a show you love and sinks one you hate', () => {
    const loved = affinityMultiplier({ avg: 9.5, count: 20 })
    const hated = affinityMultiplier({ avg: 3, count: 20 })
    expect(loved).toBeGreaterThan(1.4)
    expect(hated).toBeLessThan(0.5)
    expect(loved).toBeGreaterThan(hated)
  })

  it('stays positive at the extremes, so taste vectors never flip sign', () => {
    for (const avg of [1, 5, 7, 10]) {
      expect(affinityMultiplier({ avg, count: 500 })).toBeGreaterThan(0)
    }
  })

  it('shrinks a verdict resting on a single rating toward neutral', () => {
    const oneRating = affinityMultiplier({ avg: 10, count: 1 })
    const manyRatings = affinityMultiplier({ avg: 10, count: 40 })
    expect(oneRating).toBeLessThan(manyRatings)
    expect(oneRating).toBeGreaterThan(1)
  })
})

describe('ratingAgreement', () => {
  const mine = new Map([
    [1, { avg: 9, count: 5 }],
    [2, { avg: 4, count: 5 }],
  ])

  it('scores nothing when the two have rated no show in common', () => {
    const theirs = new Map([[9, { avg: 8, count: 2 }]])
    expect(ratingAgreement(mine, theirs)).toEqual({ shared: [], score: null })
  })

  it('scores 1 when both people land on the same numbers', () => {
    const result = ratingAgreement(mine, new Map(mine))
    expect(result.score).toBe(1)
    expect(result.shared).toHaveLength(2)
  })

  it('drops as the two disagree', () => {
    const close = ratingAgreement(mine, new Map([[1, { avg: 8.5, count: 3 }]]))
    const far = ratingAgreement(mine, new Map([[1, { avg: 2, count: 3 }]]))
    expect(close.score!).toBeGreaterThan(far.score!)
    expect(far.score!).toBeGreaterThanOrEqual(0)
  })

  it('reports each side of the comparison', () => {
    const { shared } = ratingAgreement(mine, new Map([[2, { avg: 9, count: 1 }]]))
    expect(shared).toEqual([{ showId: 2, mine: 4, theirs: 9 }])
  })
})
