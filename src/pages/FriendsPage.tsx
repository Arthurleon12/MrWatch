import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { useConnections } from '../queries'
import { ChevronLeftIcon, UserIcon } from '../components/icons'

/** Tappable follower / following lists — the hub for reaching friends. */
export function FriendsPage({ kind }: { kind: 'followers' | 'following' }) {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { session, initializing } = useSession()
  const { data, isLoading, isError, refetch } = useConnections(username, kind, !!session)

  if (!supabase) return <Navigate to="/" replace />
  if (initializing) {
    return <div className="px-4 pt-6"><div className="h-40 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (!session) return <Navigate to="/auth" replace />

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
        {kind === 'followers' ? 'Followers' : 'Following'}
      </h1>
      <p className="mt-0.5 text-xs text-ink-faint">@{data?.owner ?? username}</p>

      {isLoading && <div className="mt-4 h-32 animate-pulse rounded-xl bg-surface" />}

      {isError && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-ink-soft">Couldn't load this list — check your connection.</p>
          <button
            onClick={() => void refetch()}
            className="flex-none rounded-full bg-accent px-4 py-1.5 font-display text-xs font-bold text-bg"
          >
            Retry
          </button>
        </div>
      )}

      {data === null && (
        <p className="mt-8 text-center text-sm text-ink-faint">No one here by that name.</p>
      )}

      {data && data.people.length === 0 && (
        <p className="mt-8 text-center text-sm text-ink-faint">
          {kind === 'followers'
            ? 'No followers yet — share your profile and change that.'
            : 'Not following anyone yet — find people in Search with @name.'}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {data?.people.map((p) => (
          <Link
            key={p.username}
            to={`/u/${p.username}`}
            className="flex items-center gap-3 rounded-xl bg-surface p-2.5"
          >
            <span className="h-11 w-11 flex-none overflow-hidden rounded-full bg-raised">
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
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
    </div>
  )
}
