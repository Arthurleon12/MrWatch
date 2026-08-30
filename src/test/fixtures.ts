import type { TvmEpisode, TvmShow } from '../types'

/** A TVmaze show with sane defaults — override only what a test cares about. */
export function makeShow(partial: Partial<TvmShow> & { id: number; name: string }): TvmShow {
  return {
    type: 'Scripted',
    language: 'English',
    weight: 90,
    status: 'Running',
    premiered: '2020-01-01',
    ended: null,
    genres: [],
    summary: '<p>A show.</p>',
    image: { medium: 'poster.jpg', original: 'poster.jpg' },
    network: null,
    webChannel: null,
    rating: { average: 8 },
    ...partial,
  }
}

export function makeEpisode(
  partial: Partial<TvmEpisode> & { id: number; season: number; number: number },
): TvmEpisode {
  return {
    type: 'regular',
    name: `Episode ${partial.number}`,
    airdate: '2026-01-01',
    airstamp: '2026-01-01T20:00:00+00:00',
    runtime: 45,
    summary: null,
    image: null,
    ...partial,
  }
}

/** A show carrying `count` episodes of one season, ids `startId`, `startId + 1`, … */
export function makeSeason(
  show: Partial<TvmShow> & { id: number; name: string },
  opts: { season: number; count: number; startId: number; airdate?: string },
): TvmShow {
  const episodes = Array.from({ length: opts.count }, (_, i) =>
    makeEpisode({
      id: opts.startId + i,
      season: opts.season,
      number: i + 1,
      airdate: opts.airdate ?? '2026-01-01',
      airstamp: `${opts.airdate ?? '2026-01-01'}T20:00:00+00:00`,
    }),
  )
  return makeShow({ ...show, _embedded: { episodes } })
}
