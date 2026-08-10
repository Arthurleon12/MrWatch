import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from '../queries'
import { trackShow, untrackShow, useLibrary } from '../store/library'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { Poster } from '../components/Poster'
import { CheckIcon, PlusIcon, SearchIcon, UserIcon } from '../components/icons'

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function SearchPage() {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'shows' | 'people'>('shows')
  const query = useDebounced(input, 350)
  const { data: results, isFetching } = useSearch(mode === 'shows' ? query : '')
  const { shows: tracked } = useLibrary()
  const { session } = useSession()
  const peopleEnabled = !!supabase && !!session

  const { data: people } = useQuery({
    queryKey: ['people-search', query.toLowerCase()],
    queryFn: async () => {
      const { data } = await supabase!
        .from('profiles')
        .select('username, avatar_url, bio')
        .ilike('username', `%${query.trim().replace(/^@/, '')}%`)
        .limit(12)
      return data ?? []
    },
    enabled: peopleEnabled && mode === 'people' && query.trim().length >= 2,
    staleTime: 60 * 1000,
  })

  return (
    <div className="px-4 pt-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Search</h1>

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-bg px-4 py-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-surface px-3.5">
          <SearchIcon className="h-4 w-4 flex-none text-ink-faint" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'shows' ? 'Find a show…' : 'Find a person…'}
            autoFocus
            inputMode="search"
            enterKeyHint="search"
            className="w-full bg-transparent py-3 text-[0.95rem] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        {peopleEnabled && (
          <div className="mt-2 flex gap-2">
            {(
              [
                ['shows', 'Shows'],
                ['people', 'People'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`rounded-full px-3.5 py-1 font-display text-xs font-bold transition-colors ${
                  mode === value ? 'bg-accent text-bg' : 'bg-surface text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'people' && (
        <div className="mt-2 flex flex-col gap-2">
          {(people ?? []).map((p) => (
            <Link key={p.username} to={`/u/${p.username}`} className="flex items-center gap-3 rounded-xl bg-surface p-2.5">
              <span className="h-11 w-11 flex-none overflow-hidden rounded-full bg-raised">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <UserIcon className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-sm font-bold">@{p.username}</span>
                {p.bio && <span className="block truncate text-xs text-ink-faint">{p.bio}</span>}
              </span>
            </Link>
          ))}
          {query.trim().length >= 2 && people?.length === 0 && (
            <p className="mt-8 text-center text-sm text-ink-faint">No one found by that name.</p>
          )}
          {query.trim().length < 2 && (
            <p className="mt-8 text-center text-sm text-ink-faint">
              Search usernames to find friends to follow.
            </p>
          )}
        </div>
      )}

      {mode === 'shows' && !results && !isFetching && (
        <p className="mt-10 text-center text-sm text-ink-faint">
          Search anything — from tonight's premiere to a 90s sitcom.
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {mode === 'shows' && results?.map(({ show }) => {
          const isTracked = show.id in tracked
          const year = show.premiered?.slice(0, 4)
          const network = show.network?.name ?? show.webChannel?.name
          return (
            <div key={show.id} className="flex items-center gap-3 rounded-xl bg-surface p-2.5">
              <Link to={`/show/${show.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Poster src={show.image?.medium} alt="" className="h-16 w-11 flex-none rounded-md" />
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-bold">{show.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {[year, network, show.status === 'Ended' ? 'Ended' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {show.genres.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{show.genres.join(' · ')}</p>
                  )}
                </div>
              </Link>
              <button
                onClick={() => (isTracked ? untrackShow(show.id) : trackShow(show))}
                aria-label={isTracked ? `Stop tracking ${show.name}` : `Track ${show.name}`}
                className={`flex h-10 w-10 flex-none items-center justify-center rounded-full transition-colors ${
                  isTracked
                    ? 'bg-accent text-bg'
                    : 'border-2 border-line text-ink-soft active:border-accent active:text-accent'
                }`}
              >
                {isTracked ? <CheckIcon className="h-4.5 w-4.5" /> : <PlusIcon className="h-4.5 w-4.5" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
