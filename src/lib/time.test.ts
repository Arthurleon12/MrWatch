import { describe, expect, it } from 'vitest'
import { agoLabel, dayLabel, epCode, hasAired } from './time'
import { makeEpisode } from '../test/fixtures'

const NOW = new Date('2026-08-30T12:00:00Z')

describe('hasAired', () => {
  it('uses the exact airstamp when there is one', () => {
    const ep = makeEpisode({ id: 1, season: 1, number: 1, airstamp: '2026-08-30T20:00:00Z' })
    expect(hasAired(ep, NOW)).toBe(false)
    expect(hasAired(ep, new Date('2026-08-30T20:00:01Z'))).toBe(true)
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
