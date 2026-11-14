import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HttpError,
  backoffMs,
  getShowWithEpisodes,
  isClientError,
  lookupShowByImdb,
  searchShows,
  stripHtml,
} from './tvmaze'

const ok = (body: unknown = { id: 1 }) => new Response(JSON.stringify(body), { status: 200 })
const status = (code: number, headers?: Record<string, string>) =>
  new Response('{}', { status: code, headers })

/** A fetch that never answers on its own, but does honour an abort. */
const hangUntilAborted = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) return reject(init.signal.reason)
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })

beforeEach(() => {
  vi.useFakeTimers()
  // no jitter, so waits are exact
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('request pool', () => {
  it('never runs more than four requests at once, however many are asked for', async () => {
    let inFlight = 0
    let peak = 0
    const fetchMock = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 50))
      inFlight--
      return ok()
    })
    vi.stubGlobal('fetch', fetchMock)

    const all = Promise.all(Array.from({ length: 60 }, (_, i) => getShowWithEpisodes(i + 1)))
    await vi.runAllTimersAsync()
    await all

    expect(fetchMock).toHaveBeenCalledTimes(60)
    expect(peak).toBe(4)
    expect(inFlight).toBe(0)
  })

  it('frees its slot when a request fails, so the queue keeps moving', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('/shows/1?') ? status(500) : ok()))
    vi.stubGlobal('fetch', fetchMock)

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => getShowWithEpisodes(i + 1)),
    )
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(11)
  })
})

describe('rate limiting', () => {
  it('waits as long as Retry-After asks before trying again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(ok({ id: 7 }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = getShowWithEpisodes(7)
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ id: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially when the server names no delay', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)

    const pending = getShowWithEpisodes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up with a 429 HttpError after three retries instead of looping', async () => {
    const fetchMock = vi.fn(async () => status(429))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = expect(getShowWithEpisodes(1)).rejects.toMatchObject({ name: 'HttpError', status: 429 })
    await vi.runAllTimersAsync()
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not hold a pool slot while it is backing off', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/shows/1?') ? status(429, { 'Retry-After': '10' }) : ok(),
    )
    vi.stubGlobal('fetch', fetchMock)

    const limited = getShowWithEpisodes(1).catch(() => 'gave up')
    // four slots: if the limited request kept one, these would still all finish —
    // but only after it did. They must finish while it is still waiting.
    const others = Promise.all(Array.from({ length: 8 }, (_, i) => getShowWithEpisodes(i + 2)))
    await vi.advanceTimersByTimeAsync(0)
    await expect(others).resolves.toHaveLength(8)
    await vi.runAllTimersAsync()
    await expect(limited).resolves.toBe('gave up')
  })
})

describe('backoffMs', () => {
  it('honours the server, capped so a hostile header cannot stall the app', () => {
    expect(backoffMs(0, 3, 0)).toBe(3000)
    expect(backoffMs(0, 3600, 0)).toBe(15_000)
  })

  it('doubles each attempt without a header', () => {
    expect(backoffMs(0, 0, 0)).toBe(2000)
    expect(backoffMs(1, 0, 0)).toBe(4000)
    expect(backoffMs(2, NaN, 0)).toBe(8000)
  })

  it('spreads retries out with up to a second of jitter', () => {
    expect(backoffMs(0, 0, 0.5)).toBe(2500)
    expect(backoffMs(0, 3, 0.999)).toBeLessThan(4000)
    const a = backoffMs(1, 0, 0.1)
    const b = backoffMs(1, 0, 0.9)
    expect(a).not.toBe(b)
  })
})

describe('errors', () => {
  it('reports a removed show as a 404 HttpError, without retrying', async () => {
    const fetchMock = vi.fn(async () => status(404))
    vi.stubGlobal('fetch', fetchMock)

    const error = await getShowWithEpisodes(999).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 404, message: 'TVmaze 404 for /shows/999?embed=episodes' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never tries to parse an error body as data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })))
    await expect(getShowWithEpisodes(1)).rejects.toMatchObject({ status: 502 })
  })

  it('tells refusals from failures worth another try', () => {
    expect(isClientError(new HttpError('TVmaze', 404, '/x'))).toBe(true)
    expect(isClientError(new HttpError('TMDB', 401, '/x'))).toBe(true)
    expect(isClientError(new HttpError('TVmaze', 429, '/x'))).toBe(true)
    expect(isClientError(new HttpError('TVmaze', 503, '/x'))).toBe(false)
    expect(isClientError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isClientError(undefined)).toBe(false)
  })
})

describe('aborts and timeouts', () => {
  it('rejects straight away for a signal that is already aborted', async () => {
    const fetchMock = vi.fn(hangUntilAborted)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort(new DOMException('superseded', 'AbortError'))

    await expect(searchShows('severance', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels the request in flight when the caller gives up', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted))
    const controller = new AbortController()

    const outcome = expect(searchShows('severance', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.advanceTimersByTimeAsync(10)
    controller.abort(new DOMException('superseded', 'AbortError'))
    await outcome
  })

  it('stops waiting out a rate limit when the caller gives up', async () => {
    const fetchMock = vi.fn(async () => status(429, { 'Retry-After': '10' }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const outcome = expect(getShowWithEpisodes(1, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.advanceTimersByTimeAsync(100)
    controller.abort(new DOMException('unmounted', 'AbortError'))
    await outcome
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out a request that hangs for fifteen seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted))

    const outcome = expect(getShowWithEpisodes(1)).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await outcome
  })
})

describe('request shape', () => {
  it('encodes what the user typed', async () => {
    const fetchMock = vi.fn(async (_url: string) => ok([]))
    vi.stubGlobal('fetch', fetchMock)

    await searchShows('law & order: svu?')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.tvmaze.com/search/shows?q=law%20%26%20order%3A%20svu%3F',
    )
    await lookupShowByImdb('tt0903747')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.tvmaze.com/lookup/shows?imdb=tt0903747')
  })
})

describe('stripHtml', () => {
  it('decodes the entities TVmaze summaries carry', () => {
    expect(stripHtml('<p><b>American Agenda</b> with Bob Brooks &amp; Katrina Szish&nbsp;is a show.</p>')).toBe(
      'American Agenda with Bob Brooks & Katrina Szish is a show.',
    )
    expect(stripHtml('It&#39;s &quot;fine&quot; &#x2014; really&hellip;')).toBe('It\'s "fine" — really…')
  })

  it('keeps paragraphs and line breaks apart', () => {
    expect(stripHtml('<p>One.</p><p>Two.</p>')).toBe('One. Two.')
    expect(stripHtml('First<br/>Second<br>Third')).toBe('First Second Third')
  })

  it('does not decode twice', () => {
    expect(stripHtml('the &amp;lt;b&amp;gt; tag')).toBe('the &lt;b&gt; tag')
  })

  it('leaves an entity it does not know as written', () => {
    expect(stripHtml('5 &fakeentity; 6')).toBe('5 &fakeentity; 6')
  })

  it('returns nothing for nothing', () => {
    expect(stripHtml(null)).toBe('')
    expect(stripHtml('')).toBe('')
    expect(stripHtml('<p>  </p>')).toBe('')
  })
})
