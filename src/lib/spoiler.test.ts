import { describe, expect, it } from 'vitest'
import { buildProgress, compareRefs, isSpoiler, parseEpCode } from './spoiler'
import { makeSeason } from '../test/fixtures'

const NOW = new Date('2026-03-01T00:00:00Z')

/** Ten episodes of season 1, ids 101–110, all aired well before NOW. */
const aired = makeSeason({ id: 1, name: 'Aired Show' }, {
  season: 1,
  count: 10,
  startId: 101,
  airdate: '2026-01-01',
})

describe('parseEpCode', () => {
  it('reads the codes the app writes', () => {
    expect(parseEpCode('S5E01')).toEqual({ season: 5, number: 1 })
    expect(parseEpCode('s05e12')).toEqual({ season: 5, number: 12 })
    expect(parseEpCode(' S1E1 ')).toEqual({ season: 1, number: 1 })
  })

  it('has no opinion on specials or junk', () => {
    expect(parseEpCode('S5 Special')).toBeNull()
    expect(parseEpCode(undefined)).toBeNull()
    expect(parseEpCode('')).toBeNull()
    expect(parseEpCode('the finale')).toBeNull()
  })
})

describe('compareRefs', () => {
  it('orders by season before episode', () => {
    expect(compareRefs({ season: 1, number: 20 }, { season: 2, number: 1 })).toBeLessThan(0)
    expect(compareRefs({ season: 2, number: 2 }, { season: 2, number: 1 })).toBeGreaterThan(0)
    expect(compareRefs({ season: 3, number: 4 }, { season: 3, number: 4 })).toBe(0)
  })
})

describe('buildProgress', () => {
  it('marks the earliest aired episode you have not watched', () => {
    const progress = buildProgress([aired], { 1: [101, 102] }, NOW)
    expect(progress.get(1)).toEqual({ frontier: { season: 1, number: 3 } })
  })

  it('points at the gap, not the furthest thing watched', () => {
    // watched 1, 2, then jumped to 8 — you are still missing 3
    const progress = buildProgress([aired], { 1: [101, 102, 108] }, NOW)
    expect(progress.get(1)).toEqual({ frontier: { season: 1, number: 3 } })
  })

  it('has no frontier once everything aired has been watched', () => {
    const watched = Array.from({ length: 10 }, (_, i) => 101 + i)
    expect(buildProgress([aired], { 1: watched }, NOW).get(1)).toEqual({ frontier: null })
  })

  it('ignores episodes that have not aired yet', () => {
    const future = makeSeason({ id: 2, name: 'Future' }, {
      season: 2,
      count: 3,
      startId: 201,
      airdate: '2027-01-01',
    })
    expect(buildProgress([future], { 2: [] }, NOW).get(2)).toEqual({ frontier: null })
  })

  it('starts a tracked-but-unstarted show at its first episode', () => {
    expect(buildProgress([aired], {}, NOW).get(1)).toEqual({ frontier: { season: 1, number: 1 } })
  })
})

describe('isSpoiler', () => {
  const progress = buildProgress([aired], { 1: [101, 102] }, NOW) // frontier S1E3

  it('hides anything past where you are', () => {
    expect(isSpoiler({ season: 1, number: 7 }, progress.get(1))).toBe(true)
    expect(isSpoiler({ season: 2, number: 1 }, progress.get(1))).toBe(true)
  })

  it('shows the episode you are up to, and everything behind it', () => {
    expect(isSpoiler({ season: 1, number: 3 }, progress.get(1))).toBe(false)
    expect(isSpoiler({ season: 1, number: 1 }, progress.get(1))).toBe(false)
  })

  it('hides nothing from someone who is caught up', () => {
    const watched = Array.from({ length: 10 }, (_, i) => 101 + i)
    const caughtUp = buildProgress([aired], { 1: watched }, NOW).get(1)
    // next week's title can't spoil an episode they have already seen
    expect(isSpoiler({ season: 2, number: 1 }, caughtUp)).toBe(false)
  })

  it('leaves the pilot of an unstarted show visible', () => {
    const unstarted = buildProgress([aired], {}, NOW).get(1)
    expect(isSpoiler({ season: 1, number: 1 }, unstarted)).toBe(false)
    expect(isSpoiler({ season: 1, number: 2 }, unstarted)).toBe(true)
  })

  it('never gates a show it knows nothing about', () => {
    expect(isSpoiler({ season: 9, number: 9 }, undefined)).toBe(false)
  })

  it('never gates content with no episode attached', () => {
    expect(isSpoiler(null, progress.get(1))).toBe(false)
  })
})
