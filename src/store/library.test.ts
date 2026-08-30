import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLibraryState,
  hydrateLibrary,
  setEpisodeRating,
  setEpisodeWatched,
  setManyWatched,
  trackShow,
  untrackShow,
} from './library'
import { makeShow } from '../test/fixtures'

const show = makeShow({ id: 7, name: 'Severance', network: { name: 'Apple TV+' } })

beforeEach(() => {
  hydrateLibrary({ shows: {}, watched: {}, ratings: {} })
})

describe('tracking', () => {
  it('keeps what the show page needs to render offline', () => {
    trackShow(show)
    expect(getLibraryState().shows[7]).toMatchObject({
      id: 7,
      name: 'Severance',
      network: 'Apple TV+',
    })
  })

  it('takes the web channel when there is no broadcast network', () => {
    trackShow(makeShow({ id: 8, name: 'Web Only', webChannel: { name: 'Netflix' } }))
    expect(getLibraryState().shows[8].network).toBe('Netflix')
  })

  it('untracking clears the show, its check-ins and its ratings', () => {
    trackShow(show)
    setEpisodeRating(7, 100, 9)
    untrackShow(7)
    const state = getLibraryState()
    expect(state.shows[7]).toBeUndefined()
    expect(state.watched[7]).toBeUndefined()
    expect(state.ratings[100]).toBeUndefined()
  })
})

describe('check-ins', () => {
  it('marks and unmarks a single episode', () => {
    setEpisodeWatched(7, 100, true)
    expect(getLibraryState().watched[7]).toEqual([100])
    setEpisodeWatched(7, 100, false)
    expect(getLibraryState().watched[7]).toEqual([])
  })

  it('does not double-count an episode marked twice', () => {
    setEpisodeWatched(7, 100, true)
    setEpisodeWatched(7, 100, true)
    expect(getLibraryState().watched[7]).toEqual([100])
  })

  it('marks a whole season at once, and takes it back', () => {
    setManyWatched(7, [100, 101, 102], true)
    expect(getLibraryState().watched[7]).toHaveLength(3)
    setManyWatched(7, [100, 101], false)
    expect(getLibraryState().watched[7]).toEqual([102])
  })

  it('drops the rating when an episode is unwatched — in bulk too', () => {
    setEpisodeRating(7, 100, 8.5)
    setManyWatched(7, [100], false)
    expect(getLibraryState().ratings[100]).toBeUndefined()
  })
})

describe('ratings', () => {
  it('rating an episode counts as watching it', () => {
    setEpisodeRating(7, 100, 8.5)
    expect(getLibraryState().watched[7]).toEqual([100])
    expect(getLibraryState().ratings[100]).toBe(8.5)
  })

  it('holds the scale at 1 to 10, one decimal', () => {
    setEpisodeRating(7, 100, 12)
    expect(getLibraryState().ratings[100]).toBe(10)
    setEpisodeRating(7, 101, 0)
    expect(getLibraryState().ratings[101]).toBe(1)
    setEpisodeRating(7, 102, 7.26)
    expect(getLibraryState().ratings[102]).toBe(7.3)
  })

  it('clears a rating without unwatching the episode', () => {
    setEpisodeRating(7, 100, 9)
    setEpisodeRating(7, 100, null)
    expect(getLibraryState().ratings[100]).toBeUndefined()
    expect(getLibraryState().watched[7]).toEqual([100])
  })
})

describe('persistence', () => {
  it('writes through to localStorage', () => {
    trackShow(show)
    const raw = localStorage.getItem('mrwatch:library:v1')
    expect(JSON.parse(raw!).shows['7'].name).toBe('Severance')
  })

  it('loads a state saved before ratings existed', async () => {
    localStorage.setItem(
      'mrwatch:library:v1',
      JSON.stringify({ shows: {}, watched: { 7: [100] } }),
    )
    vi.resetModules()
    const fresh = await import('./library')
    expect(fresh.getLibraryState().ratings).toEqual({})
    expect(fresh.getLibraryState().watched[7]).toEqual([100])
  })

  it('starts clean rather than crashing on corrupted storage', async () => {
    localStorage.setItem('mrwatch:library:v1', '{not json')
    vi.resetModules()
    const fresh = await import('./library')
    expect(fresh.getLibraryState()).toEqual({ shows: {}, watched: {}, ratings: {} })
  })
})
