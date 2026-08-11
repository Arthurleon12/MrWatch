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

/**
 * One search box, no modes: shows and people are searched together, so a
 * query can never land in the "wrong" tab and look broken. Prefix with @
 * to search people only.
 */
export function SearchPage() {
  const [input, setInput] = useState('')
  const query = useDebounced(input, 350)
  const peopleOnly = query.trimStart().startsWith('@')
  const cleanQuery = query.trim().replace(/^@/, '')

  const { data: results, isFetching } = useSearch(peopleOnly ? '' : query)
  const { shows: tracked } = useLibrary()
  const { session } = useSession()
  const peopleEnabled = !!supabase && !!session

  const { data: people } = useQuery({
    queryKey: ['people-search', cleanQuery.toLowerCase()],
    queryFn: async () => {
      const { data } = await supabase!
        .from('profiles')
        .select('username, avatar_url, bio')
        .ilike('username', `%${cleanQuery}%`)
        .limit(peopleOnly ? 12 : 4)
      return data ?? []
    },
    enabled: peopleEnabled && cleanQuery.length >= 2,
    staleTime: 60 * 1000,
  })

  const showEmptyHint = !results && !isFetching && !peopleOnly

  return (
    <div className="px-4 pt-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Search</h1>

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-bg px-4 py-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-surface px-3.5">
          <SearchIcon className="h-4 w-4 flex-none text-ink-faint" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={peopleEnabled ? 'Shows, or @people…' : 'Find a show…'}
            autoFocus
            inputMode="search"
            enterKeyHint="search"
            className="w-full bg-transparent py-3 text-[0.95rem] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      {showEmptyHint && (
        <p className="mt-10 text-center text-sm text-ink-faint">
          Search anything — from tonight's premiere to a 90s sitcom.
          {peopleEnabled && (
            <>
              <br />
              Type <span className="text-accent">@name</span> to find people.
            </>
          )}
        </p>
      )}

      {/* ---- people (folded in above shows; the whole list when @-prefixed) ---- */}
      {(people?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {!peopleOnly && (
            <p className="font-display text-[0.65rem] font-bold uppercase tracking-[0.15em] text-ink-faint">
              People
            </p>
          )}
          {people!.map((p) => (
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
        </div>
      )}

      {peopleOnly && cleanQuery.length >= 2 && people?.length === 0 && (
        <p className="mt-8 text-center text-sm text-ink-faint">No one found by that name.</p>
      )}
      {peopleOnly && cleanQuery.length < 2 && (
        <p className="mt-8 text-center text-sm text-ink-faint">Keep typing to search usernames…</p>
      )}

      {/* ---- shows ---- */}
      <div className="mt-2 flex flex-col gap-2">
        {(people?.length ?? 0) > 0 && !peopleOnly && (results?.length ?? 0) > 0 && (
          <p className="mt-2 font-display text-[0.65rem] font-bold uppercase tracking-[0.15em] text-ink-faint">
            Shows
          </p>
        )}
        {!peopleOnly && results?.map(({ show }) => {
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
