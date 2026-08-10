import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLibrary } from '../store/library'
import { useArticles } from '../store/articles'
import { useProfile } from '../store/profile'
import { useSettings } from '../store/settings'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { useFansAlsoWatch, useScheduleWindow, useTrackedShowDetails } from '../queries'
import { stripHtml } from '../api/tvmaze'
import { buildTasteProfile, rankCandidates } from '../lib/recommend'
import { agoLabel } from '../lib/time'
import { Poster } from '../components/Poster'
import { PencilIcon } from '../components/icons'
import type { TvmShow } from '../types'

type Lens = 'all' | 'shows' | 'anime'

function isAnime(show: TvmShow): boolean {
  return show.genres.includes('Anime')
}

function snippet(show: TvmShow, len = 140): string {
  const text = stripHtml(show.summary)
  return text.length > len ? `${text.slice(0, len).trimEnd()}…` : text
}

interface FeedArticle {
  id: string
  title: string
  body: string
  subject: { showId: number; showName: string; image: string | null; epCode?: string }
  author: string
  createdAt: number
}

export function ForYouPage() {
  const { shows: tracked, watched } = useLibrary()
  const localArticles = useArticles()
  const profile = useProfile()
  const { tmdbKey } = useSettings()
  const { session, profileStatus } = useSession()
  const [lens, setLens] = useState<Lens>('all')

  const signedIn = !!session && profileStatus === 'ready'
  const { data: communityArticles } = useQuery({
    queryKey: ['feed-articles'],
    queryFn: async (): Promise<FeedArticle[]> => {
      const { data } = await supabase!
        .from('articles')
        .select('id, title, body, subject, created_at, profiles(username)')
        .order('created_at', { ascending: false })
        .limit(25)
      return (data ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        subject: a.subject,
        author: (a.profiles as unknown as { username: string })?.username ?? 'someone',
        createdAt: new Date(a.created_at).getTime(),
      }))
    },
    enabled: signedIn,
    staleTime: 60 * 1000,
  })

  // signed in: everyone's articles (friends & family feed); local mode: your own
  const articles: FeedArticle[] = signedIn && communityArticles ? communityArticles : localArticles

  const trackedIdList = Object.keys(tracked).map(Number)
  const trackedDetails = useTrackedShowDetails(trackedIdList)
  const windowQueries = useScheduleWindow()

  const isLoading = windowQueries.some((q) => q.isLoading)

  /** Distinct shows from the release window — the candidate pool. */
  const candidates = useMemo(() => {
    const byId = new Map<number, TvmShow>()
    for (const q of windowQueries) {
      for (const item of q.data ?? []) {
        const show = item.show ?? item._embedded?.show
        if (show && !byId.has(show.id)) byId.set(show.id, show)
      }
    }
    return [...byId.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowQueries.map((q) => q.dataUpdatedAt).join(',')])

  const tasteProfile = useMemo(
    () =>
      buildTasteProfile({
        details: trackedDetails.map((q) => q.data).filter((d): d is TvmShow => !!d),
        watched,
        ladder: profile.top10Shows,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackedDetails.map((q) => q.dataUpdatedAt).join(','), watched, profile.top10Shows],
  )

  const lensFilter = (s: TvmShow) =>
    lens === 'all' ? true : lens === 'anime' ? isAnime(s) : !isAnime(s)

  const trackedIds = new Set(trackedIdList)
  const topPicks = useMemo(
    () => rankCandidates(candidates.filter(lensFilter), tasteProfile, trackedIds, 10),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, tasteProfile, lens, trackedIdList.join(',')],
  )
  const animeCount = candidates.filter((s) => !trackedIds.has(s.id) && isAnime(s)).length

  /** Collaborative rails: seeds = your top-ladder shows (fallback: first tracked). */
  const seeds = useMemo(() => {
    const ids = (profile.top10Shows.length > 0 ? profile.top10Shows.map((s) => s.id) : trackedIdList).slice(0, 2)
    return ids
      .map((id) => trackedDetails.find((q) => q.data?.id === id)?.data)
      .filter((d): d is TvmShow => !!d)
      .map((d) => ({ id: d.id, name: d.name, imdb: d.externals?.imdb ?? null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.top10Shows, trackedIdList.join(','), trackedDetails.map((q) => q.dataUpdatedAt).join(',')])
  const fansQueries = useFansAlsoWatch(seeds, tmdbKey)

  return (
    <div className="px-4 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">For You</h1>
        <Link
          to="/write"
          className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 font-display text-xs font-bold text-bg"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Write
        </Link>
      </div>

      {/* lens chips */}
      <div className="mt-3 flex gap-2">
        {(
          [
            ['all', 'Everything'],
            ['shows', 'TV shows'],
            ['anime', `Anime${animeCount ? ` · ${animeCount}` : ''}`],
          ] as [Lens, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setLens(value)}
            className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
              lens === value ? 'bg-accent text-bg' : 'bg-surface text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[0.68rem] text-ink-faint">
        Movies join the mix once the TMDB catalog is connected.
      </p>

      {/* ---- articles ---- */}
      <section className="mt-6">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
          Articles
        </h2>
        {articles.length === 0 ? (
          <div className="mt-2 rounded-xl bg-surface p-4">
            <p className="text-sm text-ink-soft">
              No articles yet. Write the first one — a review, a theory, a ranking — and it lands
              here. When accounts launch, articles from people you follow join this feed.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {articles.map((a) => (
              <Link key={a.id} to={`/article/${a.id}`} className="block rounded-xl bg-surface p-3">
                <span className="flex items-center gap-2">
                  <Poster src={a.subject.image} alt="" className="h-14 w-10 flex-none rounded-md" />
                  <span className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 font-display text-[0.62rem] font-bold uppercase tracking-wider text-accent">
                      <span className="truncate">
                        {a.subject.epCode
                          ? `${a.subject.showName} · ${a.subject.epCode}`
                          : a.subject.showName}
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate font-display text-sm font-bold text-ink">
                      {a.title}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      @{a.author} · {agoLabel(new Date(a.createdAt))}
                    </span>
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-snug text-ink-soft">
                  {a.body.length > 140 ? `${a.body.slice(0, 140).trimEnd()}…` : a.body}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ---- fans also watch (collaborative, via TMDB) ---- */}
      {tmdbKey ? (
        fansQueries.map((q) =>
          q.data && q.data.shows.length > 0 ? (
            <section key={q.data.seedName} className="mt-8">
              <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
                Fans of {q.data.seedName} also watch
              </h2>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {q.data.shows
                  .filter((s) => !trackedIds.has(s.id))
                  .map((show) => (
                    <Link key={show.id} to={`/show/${show.id}`} className="w-24 flex-none">
                      <Poster src={show.image?.medium} alt="" className="h-34 w-24 rounded-lg" />
                      <p className="mt-1 truncate text-[0.68rem] text-ink-soft">{show.name}</p>
                      {show.rating?.average && (
                        <p className="text-[0.62rem] text-ink-faint">★ {show.rating.average.toFixed(1)}</p>
                      )}
                    </Link>
                  ))}
              </div>
            </section>
          ) : null,
        )
      ) : (
        trackedIdList.length > 0 && (
          <section className="mt-8 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-display text-sm font-bold">Unlock "fans also watch"</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Connect a free TMDB API key and For You adds what people who watch your shows
              actually watch — real viewing patterns from millions of TMDB users, until MrWatch
              has a community of its own.
            </p>
            <Link to="/profile" className="mt-2 inline-block text-xs font-bold text-accent">
              Connect in Profile →
            </Link>
          </section>
        )
      )}

      {/* ---- top picks ---- */}
      <section className="mt-8">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
          {trackedIdList.length > 0 ? 'Top picks for you' : 'Releasing this week'}
        </h2>
        <p className="mt-1 text-[0.68rem] text-ink-faint">
          New and returning shows this week, matched to your taste.
        </p>

        {isLoading && <div className="mt-3 h-40 animate-pulse rounded-xl bg-surface" />}

        {!isLoading && topPicks.length === 0 && (
          <p className="mt-2 text-sm text-ink-faint">Nothing in this lens right now.</p>
        )}

        <div className="mt-3 flex flex-col gap-3">
          {topPicks.map(({ show, match, because }) => (
            <Link key={show.id} to={`/show/${show.id}`} className="flex gap-3 rounded-xl bg-surface p-3">
              <Poster src={show.image?.medium} alt="" className="h-28 w-20 flex-none rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-display text-sm font-bold">{show.name}</p>
                  <span className="flex-none rounded-full bg-raised px-2 py-0.5 font-display text-[0.62rem] font-bold text-accent tabular-nums">
                    {match}% match
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-faint">
                  {[
                    isAnime(show) ? 'Anime' : show.genres[0],
                    show.network?.name ?? show.webChannel?.name,
                    show.rating?.average ? `★ ${show.rating.average.toFixed(1)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-soft">{snippet(show)}</p>
                <p className="mt-1 truncate text-[0.65rem] font-medium text-accent/80">{because}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
