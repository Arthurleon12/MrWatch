/**
 * PostgREST caps every response at ~1000 rows. A real watch history blows
 * straight past that — it once froze an episode count at exactly 1000, and
 * because the push path prunes rows the cloud doesn't know about, the
 * truncated pull then deleted the rest of the history for good.
 *
 * Every unbounded select goes through here: keep asking for the next page
 * until one comes back short.
 */

export const PAGE_SIZE = 1000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export type PagedFetch<T> = (from: number, to: number) => Promise<PageResult<T>>

/**
 * Reads every page of a range-able query. `from`/`to` are inclusive, matching
 * supabase's `.range()`. A page shorter than `pageSize` is the last one.
 */
export async function fetchAllPages<T>(
  fetchPage: PagedFetch<T>,
  pageSize = PAGE_SIZE,
): Promise<{ rows: T[]; error: null } | { rows: null; error: { message: string } }> {
  if (pageSize < 1) throw new Error('fetchAllPages: pageSize must be at least 1')
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const res = await fetchPage(from, from + pageSize - 1)
    if (res.error) return { rows: null, error: res.error }
    const page = res.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return { rows, error: null }
  }
}
