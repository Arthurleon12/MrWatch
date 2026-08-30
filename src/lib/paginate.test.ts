import { describe, expect, it } from 'vitest'
import { fetchAllPages, type PageResult } from './paginate'

/**
 * This is the regression guard for the worst bug this app has had: a
 * truncated read of the watch history that the push path then treated as the
 * whole truth and pruned the cloud down to match. Anything that reads an
 * unbounded table has to survive these cases.
 */

/** A fake table of `total` rows that answers range requests like PostgREST. */
function table(total: number, pageCap: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: [number, number][] = []
  const fetchPage = async (from: number, to: number): Promise<PageResult<{ id: number }>> => {
    calls.push([from, to])
    // the server never returns more than its cap, whatever the range asks for
    return { data: rows.slice(from, Math.min(to + 1, from + pageCap)), error: null }
  }
  return { fetchPage, calls }
}

describe('fetchAllPages', () => {
  it('reads a history that runs past a single page', async () => {
    const { fetchPage } = table(2500, 1000)
    const res = await fetchAllPages(fetchPage)
    expect(res.error).toBeNull()
    expect(res.rows).toHaveLength(2500)
    expect(res.rows?.[2499]).toEqual({ id: 2499 })
  })

  it('does not stop at exactly one page — the 1000-row cliff', async () => {
    const { fetchPage } = table(1000, 1000)
    const res = await fetchAllPages(fetchPage)
    // 1000 rows is a FULL page: it must ask again and only then conclude
    expect(res.rows).toHaveLength(1000)
  })

  it('terminates when the row count is an exact multiple of the page size', async () => {
    const { fetchPage, calls } = table(2000, 1000)
    const res = await fetchAllPages(fetchPage)
    expect(res.rows).toHaveLength(2000)
    expect(calls).toHaveLength(3) // two full pages, then an empty one
  })

  it('requests inclusive ranges, the way supabase .range() expects', async () => {
    const { fetchPage, calls } = table(1500, 1000)
    await fetchAllPages(fetchPage)
    expect(calls[0]).toEqual([0, 999])
    expect(calls[1]).toEqual([1000, 1999])
  })

  it('stops immediately on a short first page', async () => {
    const { fetchPage, calls } = table(12, 1000)
    const res = await fetchAllPages(fetchPage)
    expect(res.rows).toHaveLength(12)
    expect(calls).toHaveLength(1)
  })

  it('reports an empty history as empty, not as an error', async () => {
    const { fetchPage } = table(0, 1000)
    const res = await fetchAllPages(fetchPage)
    expect(res).toEqual({ rows: [], error: null })
  })

  it('surfaces a failed page as an error instead of a partial history', async () => {
    let call = 0
    const res = await fetchAllPages<{ id: number }>(async () => {
      call++
      if (call === 1) return { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
      return { data: null, error: { message: 'connection reset' } }
    })
    // partial rows here would look like a shrunken history and get pruned
    expect(res.rows).toBeNull()
    expect(res.error).toEqual({ message: 'connection reset' })
  })

  it('honours a smaller page size', async () => {
    const { fetchPage, calls } = table(25, 10)
    const res = await fetchAllPages(fetchPage, 10)
    expect(res.rows).toHaveLength(25)
    expect(calls).toHaveLength(3)
  })

  it('refuses a page size that would never terminate', async () => {
    await expect(fetchAllPages(async () => ({ data: [], error: null }), 0)).rejects.toThrow(
      /at least 1/,
    )
  })
})
