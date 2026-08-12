import { useEffect } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { useNotifications } from '../queries'
import { agoLabel } from '../lib/time'
import { ChevronLeftIcon, HeartIcon, UserIcon } from '../components/icons'

/** The bell feed: who followed you, who liked your posts — Insta-style. */
export function NotificationsPage() {
  const navigate = useNavigate()
  const { session, initializing } = useSession()
  const uid = session?.user.id
  const queryClient = useQueryClient()
  const { data: items, isLoading, isError, refetch } = useNotifications(uid)

  // seeing the list clears the badge — mark everything read
  useEffect(() => {
    if (!supabase || !uid || !items?.some((n) => !n.read)) return
    void supabase
      .from('notifications')
      .update({ read: true })
      .eq('recipient_id', uid)
      .eq('read', false)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['notif-unread', uid] })
      })
  }, [items, uid, queryClient])

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
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Notifications</h1>

      {isLoading && <div className="mt-4 h-32 animate-pulse rounded-xl bg-surface" />}

      {isError && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-ink-soft">Couldn't load notifications — check your connection.</p>
          <button
            onClick={() => void refetch()}
            className="flex-none rounded-full bg-accent px-4 py-1.5 font-display text-xs font-bold text-bg"
          >
            Retry
          </button>
        </div>
      )}

      {items && items.length === 0 && (
        <p className="mt-8 text-center text-sm text-ink-faint">
          Quiet for now — when someone follows you or likes a post, it lands here.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {items?.map((n) => {
          const target =
            n.type === 'like' && n.payload.articleId
              ? `/article/${n.payload.articleId}`
              : `/u/${n.actor.username}`
          return (
            <Link
              key={n.id}
              to={target}
              className={`flex items-center gap-3 rounded-xl p-3 ${
                n.read ? 'bg-surface' : 'border border-accent/40 bg-surface'
              }`}
            >
              <span className="h-10 w-10 flex-none overflow-hidden rounded-full bg-raised">
                {n.actor.avatarUrl ? (
                  <img src={n.actor.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <UserIcon className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-snug">
                <span className="font-display font-bold">@{n.actor.username}</span>{' '}
                {n.type === 'follow' ? (
                  <span className="text-ink-soft">started following you</span>
                ) : (
                  <span className="text-ink-soft">
                    liked {n.payload.title ? `“${n.payload.title}”` : 'your post'}
                  </span>
                )}
                <span className="block text-xs text-ink-faint">{agoLabel(new Date(n.createdAt))}</span>
              </span>
              {n.type === 'like' && <HeartIcon filled className="h-4 w-4 flex-none text-accent" />}
              {!n.read && <span className="h-2 w-2 flex-none rounded-full bg-accent" />}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
