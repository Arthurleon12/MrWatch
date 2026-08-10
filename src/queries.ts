import { useQueries, useQuery } from '@tanstack/react-query'
import { getShowWithEpisodes, getTodaySchedule, getTodayWebSchedule, isoDate, searchShows } from './api/tvmaze'
import { fansAlsoWatch } from './api/tmdb'
import type { TvmShow } from './types'

const SHOW_STALE_MS = 60 * 60 * 1000 // an hour is plenty for episode metadata

export function useShow(id: number) {
  return useQuery({
    queryKey: ['show', id],
    queryFn: () => getShowWithEpisodes(id),
    staleTime: SHOW_STALE_MS,
    enabled: id > 0,
  })
}

export function useTrackedShowDetails(ids: number[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['show', id],
      queryFn: () => getShowWithEpisodes(id),
      staleTime: SHOW_STALE_MS,
    })),
  })
}

export function useTodaySchedules() {
  return useQueries({
    queries: [
      { queryKey: ['schedule', 'broadcast', isoDate()], queryFn: () => getTodaySchedule(), staleTime: SHOW_STALE_MS },
      { queryKey: ['schedule', 'web', isoDate()], queryFn: () => getTodayWebSchedule(), staleTime: SHOW_STALE_MS },
    ],
  })
}

/**
 * A window of release days (yesterday → +3 days), broadcast + streaming.
 * This is the candidate pool for taste-based recommendations until the
 * backend maintains a proper catalog.
 */
export function useScheduleWindow() {
  const offsets = [-1, 0, 1, 2, 3]
  return useQueries({
    queries: offsets.flatMap((off) => [
      {
        queryKey: ['schedule', 'broadcast', isoDate(off)],
        queryFn: () => getTodaySchedule(isoDate(off)),
        staleTime: SHOW_STALE_MS,
      },
      {
        queryKey: ['schedule', 'web', isoDate(off)],
        queryFn: () => getTodayWebSchedule(isoDate(off)),
        staleTime: SHOW_STALE_MS,
      },
    ]),
  })
}

/** "People who watch <seed> also watch …" via TMDB, mapped to TVmaze shows. */
export function useFansAlsoWatch(seeds: { id: number; name: string; imdb: string | null }[], tmdbKey: string) {
  return useQueries({
    queries: seeds.map((seed) => ({
      queryKey: ['fans-also-watch', seed.id],
      queryFn: async (): Promise<{ seedName: string; shows: TvmShow[] }> => ({
        seedName: seed.name,
        shows: seed.imdb ? await fansAlsoWatch(seed.imdb, tmdbKey) : [],
      }),
      enabled: tmdbKey.length > 0 && !!seed.imdb,
      staleTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  })
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => searchShows(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}
