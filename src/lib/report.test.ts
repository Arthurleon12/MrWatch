import { describe, expect, it } from 'vitest'
import {
  createThrottle,
  normalizeError,
  scrubRoute,
  takeReportSlot,
  truncate,
} from './report'

describe('normalizeError', () => {
  it('keeps an Error whole', () => {
    const error = new Error('boom')
    const result = normalizeError(error)
    expect(result.message).toBe('boom')
    expect(result.stack).toContain('boom')
  })

  it('falls back to the error name when there is no message', () => {
    expect(normalizeError(new TypeError()).message).toBe('TypeError')
  })

  it('handles the things JavaScript lets you throw that are not Errors', () => {
    expect(normalizeError('just a string').message).toBe('just a string')
    expect(normalizeError({ message: 'from an object' }).message).toBe('from an object')
    expect(normalizeError({ code: 42 }).message).toBe('{"code":42}')
    expect(normalizeError(null).message).toBe('Unknown error')
    expect(normalizeError(undefined).message).toBe('Unknown error')
  })

  it('survives a value that cannot be serialized', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(normalizeError(circular).message).toBe('Unserializable error')
  })

  it('truncates a message that would breach the column limit', () => {
    const result = normalizeError(new Error('x'.repeat(900)))
    expect(result.message.length).toBeLessThanOrEqual(500)
  })

  it('truncates a stack that would breach the column limit', () => {
    const error = new Error('deep')
    error.stack = 'at frame\n'.repeat(2000)
    expect(normalizeError(error).stack!.length).toBeLessThanOrEqual(4000)
  })
})

describe('truncate', () => {
  it('leaves short values alone', () => {
    expect(truncate('short', 10)).toBe('short')
  })

  it('marks a value it cut', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('scrubRoute', () => {
  it('logs a screen with nothing identifying in it as itself', () => {
    expect(scrubRoute('/')).toBe('/')
    expect(scrubRoute('/foryou')).toBe('/foryou')
    expect(scrubRoute('/settings')).toBe('/settings')
  })

  it('reduces a path to the route it matched', () => {
    expect(scrubRoute('/show/44933')).toBe('/show/:id')
    expect(scrubRoute('/movie/693134')).toBe('/movie/:id')
    expect(scrubRoute('/rank/44933')).toBe('/rank/:id')
    expect(scrubRoute('/rank/movie/693134')).toBe('/rank/movie/:id')
    expect(scrubRoute('/article/8b1f0e9a-0000-4000-8000-000000000000')).toBe('/article/:id')
  })

  it('never lets a username reach the log', () => {
    expect(scrubRoute('/u/Arthur')).toBe('/u/:username')
    expect(scrubRoute('/together/Oren')).toBe('/together/:username')
    expect(scrubRoute('/friends/Arthur/followers')).toBe('/friends/:username/followers')
    expect(scrubRoute('/friends/Arthur/following')).toBe('/friends/:username/following')
  })

  it('refuses to echo an unrecognised path back', () => {
    // a 404 path is whatever was typed — it does not belong in a log
    expect(scrubRoute('/secret-token-abc123')).toBe('/other')
    expect(scrubRoute('/u/Arthur/extra/segments')).toBe('/other')
  })

  it('treats a trailing slash as the same screen', () => {
    expect(scrubRoute('/foryou/')).toBe('/foryou')
    expect(scrubRoute('/show/44933/')).toBe('/show/:id')
  })
})

describe('takeReportSlot', () => {
  const NOW = 1_000_000

  it('lets a first report through', () => {
    expect(takeReportSlot(createThrottle(), 'render|/foryou|boom', NOW)).toBe(true)
  })

  it('refuses the same failure again inside the repeat window', () => {
    const state = createThrottle()
    expect(takeReportSlot(state, 'sig', NOW)).toBe(true)
    // a component throwing every render must cost one row, not one per frame
    expect(takeReportSlot(state, 'sig', NOW + 5)).toBe(false)
    expect(takeReportSlot(state, 'sig', NOW + 59_000)).toBe(false)
  })

  it('lets a failure that is still happening later be heard again', () => {
    const state = createThrottle()
    takeReportSlot(state, 'sig', NOW)
    expect(takeReportSlot(state, 'sig', NOW + 60_001)).toBe(true)
  })

  it('keeps different failures independent', () => {
    const state = createThrottle()
    expect(takeReportSlot(state, 'render|/foryou|a', NOW)).toBe(true)
    expect(takeReportSlot(state, 'render|/foryou|b', NOW)).toBe(true)
  })

  it('caps what one page load can send, however varied the failures', () => {
    const state = createThrottle()
    const accepted = Array.from({ length: 40 }, (_, i) =>
      takeReportSlot(state, `sig-${i}`, NOW),
    ).filter(Boolean)
    expect(accepted).toHaveLength(12)
  })
})
