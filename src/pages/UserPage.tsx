import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { useProfile } from '../store/profile'
import { agoLabel } from '../lib/time'
import { Poster } from '../components/Poster'
import { ChevronLeftIcon, UserIcon } from '../components/icons'
import type { Top10Show } from '../store/profile'

interface RemoteProfile {
  id: string
  username: string
  bio: string
  avatar_url: string | null
  top10_shows: Top10Show[]
}

export function UserPage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const ownName = useProfile().username
  const queryClient = useQueryClient()
  const uid = session?.user.id

  const { data: person, isLoading } = useQuery({
    queryKey: ['user', username.toLowerCase()],
    queryFn: async (): Promise<RemoteProfile | null> => {
      const { data } = await supabase!
        .from('profiles')
        .select('id, username, bio, avatar_url, top10_shows')
        .ilike('username', username)
        .maybeSingle()
      return data
    },
    enabled: !!supabase && !!session,
  })

  const { data: extras } = useQuery({
    queryKey: ['user-extras', person?.id],
    queryFn: async () => {
      const [tracks, followers, following, meFollowing, articles] = await Promise.all([
        supabase!.from('tracks').select('show_id, name, image').eq('user_id', person!.id).order('added_at', { ascending: false }),
        supabase!.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', person!.id),
        supabase!.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', person!.id),
        supabase!.from('follows').select('followee_id').eq('follower_id', uid!).eq('followee_id', person!.id).maybeSingle(),
        supabase!.from('articles').select('id, title, subject, created_at').eq('user_id', person!.id).order('created_at', { ascending: false }).limit(5),
      ])
      return {
        tracks: tracks.data ?? [],
        followers: followers.count ?? 0,
        following: following.count ?? 0,
        iFollow: !!meFollowing.data,
        articles: articles.data ?? [],
      }
    },
    enabled: !!person?.id && !!uid,
  })

  const followMutation = useMutation({
    mutationFn: async (follow: boolean) => {
      if (follow) {
        await supabase!.from('follows').insert({ follower_id: uid!, followee_id: person!.id })
      } else {
        await supabase!.from('follows').delete().eq('follower_id', uid!).eq('followee_id', person!.id)
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['user-extras', person?.id] }),
  })

  if (!supabase) return <Navigate to="/" replace />
  if (!session) return <Navigate to="/auth" replace />
  if (username.toLowerCase() === ownName.toLowerCase()) return <Navigate to="/profile" replace />

  if (isLoading) {
    return <div className="px-4 pt-6"><div className="h-40 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (!person) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">No one here by that name.</p>
        <Link to="/search" className="mt-3 inline-block text-sm text-accent">Find people</Link>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      <div className="mt-4 flex items-center gap-4">
        <div className="h-20 w-20 flex-none overflow-hidden rounded-full bg-surface">
          {person.avatar_url ? (
            <img src={person.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-faint">
              <UserIcon className="h-9 w-9" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold">@{person.username}</h1>
          <button
            onClick={() => followMutation.mutate(!extras?.iFollow)}
            disabled={followMutation.isPending || !extras}
            className={`mt-2 rounded-full px-5 py-1.5 font-display text-xs font-bold transition-colors ${
              extras?.iFollow ? 'bg-surface text-ink-soft' : 'bg-accent text-bg'
            }`}
          >
            {extras?.iFollow ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 rounded-xl bg-surface py-3 text-center">
        {[
          [extras?.tracks.length ?? '—', 'shows'],
          [extras?.followers ?? '—', 'followers'],
          [extras?.following ?? '—', 'following'],
        ].map(([n, label]) => (
          <div key={label as string}>
            <p className="font-display text-lg font-bold tabular-nums">{n}</p>
            <p className="text-[0.65rem] uppercase tracking-wider text-ink-faint">{label}</p>
          </div>
        ))}
      </div>

      {person.bio && <p className="mt-4 text-sm leading-snug text-ink-soft">{person.bio}</p>}

      {person.top10_shows.length > 0 && (
        <section className="mt-7">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
            Top {person.top10_shows.length > 1 ? person.top10_shows.length : ''} shows
          </h2>
          <ol className="mt-3 flex flex-col gap-2">
            {person.top10_shows.slice(0, 10).map((s, i) => (
              <li key={s.id}>
                <Link to={`/show/${s.id}`} className="flex items-center gap-3 rounded-xl bg-surface p-2">
                  <span className="w-6 text-center font-display text-sm font-bold text-accent tabular-nums">{i + 1}</span>
                  <Poster src={s.image} alt="" className="h-12 w-8 flex-none rounded" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {extras && extras.articles.length > 0 && (
        <section className="mt-7">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">Articles</h2>
          <div className="mt-3 flex flex-col gap-2">
            {extras.articles.map((a) => (
              <Link key={a.id} to={`/article/${a.id}`} className="rounded-xl bg-surface p-3">
                <p className="font-display text-[0.62rem] font-bold uppercase tracking-wider text-accent">
                  {a.subject?.showName}
                  {a.subject?.epCode ? ` · ${a.subject.epCode}` : ''}
                </p>
                <p className="mt-0.5 truncate text-sm font-bold">{a.title}</p>
                <p className="text-xs text-ink-faint">{agoLabel(new Date(a.created_at))}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {extras && extras.tracks.length > 0 && (
        <section className="mt-7">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.15em] text-ink-faint">Watching</h2>
          <div className="mt-3 grid grid-cols-4 gap-2.5">
            {extras.tracks.map((t) => (
              <Link key={t.show_id} to={`/show/${t.show_id}`}>
                <Poster src={t.image} alt={t.name} className="aspect-[2/3] w-full rounded-lg" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
