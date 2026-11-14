import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agoLabel, dayLabel, epCode, hasAired } from './time'
import { makeEpisode } from '../test/fixtures'

const NOW = new Date('2026-08-30T12:00:00Z')

describe('hasAired', () => {
  it('uses the exact airstamp when there is one', () => {
    const ep = makeEpisode({ id: 1, season: 1, number: 1, airstamp: '2026-08-30T20:00:00Z' })
    expect(hasAired(ep, NOW)).toBe(false)
    expect(hasAired(ep, new Date('2026-08-30T20:00:01Z'))).toBe(true)
  })

  it('treats an unparseable airstamp as unaired rather than guessing', () => {
    const ep = makeEpisode({ id: 3, season: 1, number: 1, airstamp: 'garbage', airdate: '2020-01-01' })
    expect(hasAired(ep, NOW)).toBe(false)
  })

  it('treats the empty airdate TVmaze sends for unscheduled episodes as unaired', () => {
    const ep = makeEpisode({ id: 4, season: 1, number: 1, airdate: '', airstamp: null })
    expect(hasAired(ep, NOW)).toBe(false)
  })

  it('treats an episode with no date at all as unaired', () => {
    const ep = makeEpisode({ id: 2, season: 1, number: 1, airdate: null, airstamp: null })
    expect(hasAired(ep, NOW)).toBe(false)
  })
})

describe('epCode', () => {
  it('pads the episode number, not the season', () => {
    expect(epCode(makeEpisode({ id: 1, season: 5, number: 1 }))).toBe('S5E01')
    expect(epCode(makeEpisode({ id: 2, season: 12, number: 10 }))).toBe('S12E10')
  })

  it('labels specials instead of inventing a number', () => {
    expect(epCode({ ...makeEpisode({ id: 3, season: 2, number: 1 }), number: null })).toBe('S2 Special')
  })
})

describe('dayLabel', () => {
  it('prefers the friendly name for the days that matter', () => {
    expect(dayLabel(new Date('2026-08-30T22:00:00'), new Date('2026-08-30T09:00:00'))).toBe('Today')
    expect(dayLabel(new Date('2026-08-31T09:00:00'), new Date('2026-08-30T09:00:00'))).toBe('Tomorrow')
  })
})

describe('agoLabel', () => {
  const at = (iso: string) => agoLabel(new Date(iso), NOW)

  it('reads the way people speak about recent things', () => {
    expect(at('2026-08-30T09:00:00Z')).toBe('today')
    expect(at('2026-08-29T09:00:00Z')).toBe('yesterday')
    expect(at('2026-08-27T09:00:00Z')).toBe('3d ago')
    expect(at('2026-08-10T09:00:00Z')).toBe('2w ago')
    expect(at('2026-05-10T09:00:00Z')).toBe('3mo ago')
    expect(at('2024-05-10T09:00:00Z')).toBe('2y ago')
  })

  it('does not go negative for something dated in the future', () => {
    expect(at('2026-09-30T09:00:00Z')).toBe('today')
  })
})

describe('agoLabel across midnight', () => {
  // local-time constructors: the label is about the user's calendar day
  const oneAm = new Date(2026, 7, 30, 1, 0)

  it('calls last night "yesterday", not "today"', () => {
    expect(agoLabel(new Date(2026, 7, 29, 23, 0), oneAm)).toBe('yesterday')
  })

  it('counts calendar days, not 24-hour blocks', () => {
    // 47 hours ago, but two calendar days back
    expect(agoLabel(new Date(2026, 7, 28, 2, 0), oneAm)).toBe('2d ago')
    expect(agoLabel(new Date(2026, 7, 30, 0, 5), oneAm)).toBe('today')
  })
})

describe('day arithmetic across a clock change', () => {
  // the app's tsconfig has no node types; this is the test runner's own env
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env
  const original = env.TZ
  beforeAll(() => {
    env.TZ = 'Europe/Paris'
  })
  afterAll(() => {
    if (original === undefined) delete env.TZ
    else env.TZ = original
  })

  it('keeps "Tomorrow" when the day in between is 25 hours long', () => {
    // clocks go back on 25 Oct 2026
    expect(dayLabel(new Date('2026-10-25T12:00:00'), new Date('2026-10-24T23:30:00'))).toBe('Tomorrow')
    expect(agoLabel(new Date('2026-10-24T23:30:00'), new Date('2026-10-25T00:30:00'))).toBe('yesterday')
  })

  it('keeps "Tomorrow" when the day in between is 23 hours long', () => {
    // clocks go forward on 29 Mar 2026
    expect(dayLabel(new Date('2026-03-29T12:00:00'), new Date('2026-03-28T23:30:00'))).toBe('Tomorrow')
    expect(agoLabel(new Date('2026-03-28T12:00:00'), new Date('2026-03-30T00:30:00'))).toBe('2d ago')
  })
})
