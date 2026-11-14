import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearReturnPath, readReturnPath, safeReturnPath, stashReturnPath } from './returnTo'

const ORIGIN = 'https://mrwatch.test'

describe('safeReturnPath', () => {
  const safe = (raw: string | null | undefined) => safeReturnPath(raw, ORIGIN)

  it('accepts ordinary in-app paths', () => {
    expect(safe('/u/arthur')).toBe('/u/arthur')
    expect(safe('/together/arthur')).toBe('/together/arthur')
    expect(safe('/article/3f2a?x=1#top')).toBe('/article/3f2a?x=1#top')
    expect(safe('/')).toBe('/')
  })

  it('rejects empty and missing values', () => {
    expect(safe(null)).toBeNull()
    expect(safe(undefined)).toBeNull()
    expect(safe('')).toBeNull()
  })

  it('rejects protocol-relative URLs', () => {
    expect(safe('//evil.com')).toBeNull()
    expect(safe('//evil.com/u/arthur')).toBeNull()
  })

  it('rejects backslash tricks browsers normalise to //', () => {
    expect(safe('/\\evil.com')).toBeNull()
    expect(safe('/\\/evil.com')).toBeNull()
    expect(safe('/u/..\\..\\evil.com')).toBeNull()
  })

  it('rejects absolute URLs and other schemes', () => {
    expect(safe('https://evil.com')).toBeNull()
    expect(safe('https://mrwatch.test/u/arthur')).toBeNull() // even same-origin: relative only
    expect(safe('javascript:alert(1)')).toBeNull()
    expect(safe('data:text/html,hi')).toBeNull()
    expect(safe('u/arthur')).toBeNull()
  })

  it('rejects control characters that URL parsing would strip', () => {
    expect(safe('/\t/evil.com')).toBeNull()
    expect(safe('/\n/evil.com')).toBeNull()
    expect(safe('/u/arthur\u0000')).toBeNull()
  })

  it('rejects anything that would loop back into /auth', () => {
    expect(safe('/auth')).toBeNull()
    expect(safe('/auth?next=/u/arthur')).toBeNull()
    expect(safe('/auth/callback')).toBeNull()
    expect(safe('/u/../auth')).toBeNull() // normalised before the check
    expect(safe('/authors')).toBe('/authors') // a different route entirely
  })

  it('rejects over-length values', () => {
    expect(safe('/' + 'a'.repeat(512))).toBeNull()
    expect(safe('/' + 'a'.repeat(511))).toBe('/' + 'a'.repeat(511))
  })

  it('returns the normalised path, not the raw string', () => {
    expect(safe('/u/x/../arthur')).toBe('/u/arthur')
  })
})

describe('stash / read round trip', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: ORIGIN } })
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns what was stashed', () => {
    stashReturnPath('/u/arthur')
    expect(readReturnPath()).toBe('/u/arthur')
  })

  it('never stores an unsafe value', () => {
    stashReturnPath('//evil.com')
    expect(readReturnPath()).toBeNull()
  })

  it('keeps an earlier valid path when a later one is rejected', () => {
    stashReturnPath('/u/arthur')
    stashReturnPath(null)
    expect(readReturnPath()).toBe('/u/arthur')
  })

  it('re-validates on read, so a tampered entry is ignored', () => {
    localStorage.setItem('mrwatch:returnTo', JSON.stringify({ path: '//evil.com', at: Date.now() }))
    expect(readReturnPath()).toBeNull()
    localStorage.setItem('mrwatch:returnTo', 'not json')
    expect(readReturnPath()).toBeNull()
  })

  it('expires after 30 minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    stashReturnPath('/u/arthur')
    vi.setSystemTime(new Date('2026-01-01T00:29:00Z'))
    expect(readReturnPath()).toBe('/u/arthur')
    vi.setSystemTime(new Date('2026-01-01T00:31:00Z'))
    expect(readReturnPath()).toBeNull()
  })

  it('clears', () => {
    stashReturnPath('/u/arthur')
    clearReturnPath()
    expect(readReturnPath()).toBeNull()
  })
})
