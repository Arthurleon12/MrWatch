import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fansAlsoWatch } from './tmdb'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/**
 * Routes the four hops of the pipeline. `tvmaze` decides what the TVmaze
 * lookup answers for a given IMDb id; `externalIds` what TMDB says a
 * recommendation's IMDb id is (a Response to fail the hop).
 */
function pipeline(opts: {
  tvResults?: { id: number }[]
  recs?: number[]
  externalIds?: (tmdbId: number) => string | null | Response
  tvmaze?: (imdb: string) => Response
}) {
  return vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.hostname === 'api.tvmaze.com') {
      return opts.tvmaze?.(url.searchParams.get('imdb') ?? '') ?? json({}, 404)
    }
    if (url.pathname.includes('/find/')) return json({ tv_results: opts.tvResults ?? [{ id: 1 }] })
    if (url.pathname.endsWith('/recommendations')) {
      return json({ results: (opts.recs ?? []).map((id) => ({ id, name: `Rec ${id}`, vote_average: 8 })) })
    }
    const external = /\/tv\/(\d+)\/external_ids$/.exec(url.pathname)
    if (external) {
      const answer = opts.externalIds ? opts.externalIds(Number(external[1])) : `tt${external[1]}`
      return answer instanceof Response ? answer : json({ imdb_id: answer })
    }
    return json({}, 500)
  })
}

const show = (imdb: string) => json({ id: Number(imdb.slice(2)), name: `Show ${imdb}` })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fansAlsoWatch', () => {
  it('maps recommendations back to TVmaze shows', async () => {
    vi.stubGlobal('fetch', pipeline({ recs: [10, 11], tvmaze: show }))
    const shows = await fansAlsoWatch('tt0000001', 'key')
    expect(shows.map((s) => s.id)).toEqual([10, 11])
  })

  it('returns an empty rail when TMDB does not know the seed', async () => {
    const fetchMock = pipeline({ tvResults: [] })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fansAlsoWatch('tt0000001', 'key')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips a recommendation TVmaze has never heard of', async () => {
    vi.stubGlobal(
      'fetch',
      pipeline({ recs: [10, 11, 12], tvmaze: (imdb) => (imdb === 'tt11' ? json({}, 404) : show(imdb)) }),
    )
    const shows = await fansAlsoWatch('tt0000001', 'key')
    expect(shows.map((s) => s.id)).toEqual([10, 12])
  })

  it('skips a recommendation with no IMDb id, or one TMDB has dropped', async () => {
    vi.stubGlobal(
      'fetch',
      pipeline({
        recs: [10, 11, 12],
        externalIds: (id) => (id === 10 ? null : id === 11 ? json({}, 404) : `tt${id}`),
        tvmaze: show,
      }),
    )
    const shows = await fansAlsoWatch('tt0000001', 'key')
    expect(shows.map((s) => s.id)).toEqual([12])
  })

  it('rejects when TVmaze rate-limits it, rather than returning a short rail to be cached', async () => {
    vi.stubGlobal(
      'fetch',
      pipeline({ recs: [10, 11, 12], tvmaze: (imdb) => (imdb === 'tt11' ? json({}, 429) : show(imdb)) }),
    )
    const outcome = expect(fansAlsoWatch('tt0000001', 'key')).rejects.toMatchObject({
      name: 'HttpError',
      status: 429,
    })
    await vi.runAllTimersAsync()
    await outcome
  })

  it('rejects on a server error from either catalogue', async () => {
    vi.stubGlobal(
      'fetch',
      pipeline({ recs: [10], externalIds: () => json({}, 503), tvmaze: show }),
    )
    await expect(fansAlsoWatch('tt0000001', 'key')).rejects.toMatchObject({ status: 503 })
  })

  it('stops looking once the rail is full', async () => {
    const fetchMock = pipeline({ recs: [10, 11, 12, 13, 14], tvmaze: show })
    vi.stubGlobal('fetch', fetchMock)
    const shows = await fansAlsoWatch('tt0000001', 'key', 2)
    expect(shows.map((s) => s.id)).toEqual([10, 11])
    // find + recommendations + 2 × (external ids + lookup)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('sends a v3 key in the query string and a v4 token as a Bearer header', async () => {
    const fetchMock = pipeline({ tvResults: [] })
    vi.stubGlobal('fetch', fetchMock)

    await fansAlsoWatch('tt0000001', 'abc123')
    expect(String(fetchMock.mock.calls[0][0])).toContain('api_key=abc123')

    await fansAlsoWatch('tt0000001', 'eyJtoken')
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('eyJtoken')
    const init = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
    expect(init.headers).toEqual({ Authorization: 'Bearer eyJtoken' })
  })
})
