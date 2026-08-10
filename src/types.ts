/** Shapes returned by the TVmaze API (only the fields we use). */

export interface TvmImage {
  medium: string
  original: string
}

export interface TvmNetwork {
  name: string
}

export interface TvmShow {
  id: number
  name: string
  type?: string // "Scripted" | "Animation" | "Reality" | "Talk Show" | ...
  language?: string | null
  weight?: number // TVmaze popularity, 0–100
  status: string // "Running" | "Ended" | "To Be Determined" | "In Development"
  premiered: string | null
  ended: string | null
  genres: string[]
  summary: string | null
  image: TvmImage | null
  network: TvmNetwork | null
  webChannel: TvmNetwork | null
  rating?: { average: number | null }
  externals?: { imdb: string | null }
  _embedded?: { episodes: TvmEpisode[] }
}

export interface TvmEpisode {
  id: number
  season: number
  number: number | null // null for some specials
  type: string // "regular" | "significant_special" | ...
  name: string
  airdate: string | null // "2026-08-10"
  airstamp: string | null // full UTC instant
  runtime: number | null
  summary: string | null
  image: TvmImage | null
}

export interface TvmSearchResult {
  score: number
  show: TvmShow
}

/**
 * An entry from the schedule endpoints: an episode airing today.
 * `/schedule` nests the show directly; `/schedule/web` embeds it.
 */
export interface TvmScheduleItem extends Omit<TvmEpisode, 'image'> {
  image: TvmImage | null
  show?: TvmShow & { rating?: { average: number | null } }
  _embedded?: { show?: TvmShow & { rating?: { average: number | null } } }
}

/** What we persist locally for a tracked show. */
export interface TrackedShow {
  id: number
  name: string
  image: string | null
  status: string
  network: string | null
  premiered: string | null
  addedAt: number
}
