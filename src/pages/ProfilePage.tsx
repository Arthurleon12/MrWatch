import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { useMovies } from '../store/movies'
import {
  fileToAvatar,
  setTop10Episodes,
  setTop10Movies,
  setTop10Shows,
  updateProfile,
  useProfile,
  validateUsername,
  type Top10Episode,
} from '../store/profile'
import { useQuery } from '@tanstack/react-query'
import { useShow } from '../queries'
import { backendReady, supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { epCode, hasAired } from '../lib/time'
import { Poster } from '../components/Poster'
import { ArrowDownIcon, ArrowUpIcon, GearIcon, PencilIcon, PlusIcon, UserIcon, XIcon } from '../components/icons'

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const copy = [...list]
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

export function ProfilePage() {
  const profile = useProfile()
  const { shows, watched } = useLibrary()
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(profile.username)
  const [bioDraft, setBioDraft] = useState(profile.bio)
  const [nameError, setNameError] = useState<string | null>(null)
  const [editShows, setEditShows] = useState(false)
  const [editEpisodes, setEditEpisodes] = useState(false)
  const [editMovies, setEditMovies] = useState(false)

  const tracked = Object.values(shows).sort((a, b) => b.addedAt - a.addedAt)
  const episodesWatched = Object.values(watched).reduce((sum, list) => sum + list.length, 0)
  const { movies } = useMovies()
  const movieList = Object.values(movies)
  const moviesWatched = movieList
    .filter((m) => m.status === 'watched')
    .sort((a, b) => (b.watchedAt ?? b.addedAt) - (a.watchedAt ?? a.addedAt))
  const moviesWanted = movieList
    .filter((m) => m.status === 'want')
    .sort((a, b) => b.addedAt - a.addedAt)

  const { session, profileStatus } = useSession()
  const signedIn = !!session && profileStatus === 'ready'
  const { data: followCounts } = useQuery({
    queryKey: ['follow-counts', session?.user.id],
    queryFn: async () => {
      const [followers, following] = await Promise.all([
        supabase!.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', session!.user.id),
        supabase!.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', session!.user.id),
      ])
      return { followers: followers.count ?? 0, following: following.count ?? 0 }
    },
    enabled: signedIn,
    staleTime: 60 * 1000,
  })

  async function onPickAvatar(file: File | undefined) {
    if (!file) return
    try {
      updateProfile({ avatar: await fileToAvatar(file) })
    } catch {
      // unreadable image — leave the current avatar
    }
  }

  function saveEdits() {
    const err = validateUsername(nameDraft)
    if (err) {
      setNameError(err)
      return
    }
    updateProfile({ username: nameDraft, bio: bioDraft.slice(0, 200) })
    setNameError(null)
    setEditing(false)
  }

  return (
    <div className="px-4 pt-6">
      {/* ---- header ---- */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Change profile photo"
          className="relative h-20 w-20 flex-none overflow-hidden rounded-full bg-surface"
        >
          {profile.avatar ? (
            <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-faint">
              <UserIcon className="h-9 w-9" />
            </span>
          )}
          <span className="absolute bottom-0 inset-x-0 bg-bg/70 py-0.5 text-center text-[0.55rem] font-medium text-ink-soft">
            edit
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickAvatar(e.target.files?.[0])}
        />

        <div className="flex min-w-0 flex-1 items-center gap-2 pt-1">
          <h1 className="truncate font-display text-xl font-bold">@{profile.username || 'you'}</h1>
          <button
            onClick={() => {
              setNameDraft(profile.username)
              setBioDraft(profile.bio)
              setEditing(true)
            }}
            aria-label="Edit profile"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-surface text-ink-soft"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <Link
            to="/settings"
            aria-label="Settings"
            className="ml-auto flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface text-ink-soft"
          >
            <GearIcon className="h-4.5 w-4.5" />
          </Link>
        </div>
      </div>

      {/* ---- stats ---- */}
      <div className="mt-5 grid grid-cols-5 rounded-xl bg-surface py-3 text-center">
        {[
          [tracked.length, 'shows'],
          [episodesWatched, 'episodes'],
          [moviesWatched.length, 'movies'],
          [signedIn ? (followCounts?.followers ?? '…') : 0, 'followers'],
          [signedIn ? (followCounts?.following ?? '…') : 0, 'following'],
        ].map(([n, label]) => (
          <div key={label as string}>
            <p className="font-display text-lg font-bold tabular-nums">{n}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-ink-faint">{label}</p>
          </div>
        ))}
      </div>
      {!signedIn && (
        <p className="mt-2 text-center text-[0.68rem] text-ink-faint">
          {backendReady
            ? 'Sign in to sync your history and follow people.'
            : 'Followers and following light up when MrWatch accounts launch.'}
        </p>
      )}
      {backendReady && !session && (
        <Link
          to="/auth"
          className="mt-3 block rounded-full bg-accent py-3 text-center font-display text-sm font-bold text-bg"
        >
          Sign in / Create account
        </Link>
      )}

      {/* ---- description ---- */}
      {!editing ? (
        profile.bio ? (
          <p className="mt-4 text-sm leading-snug text-ink-soft">{profile.bio}</p>
        ) : (
          <button onClick={() => { setNameDraft(profile.username); setBioDraft(profile.bio); setEditing(true) }} className="mt-4 text-left text-sm text-ink-faint">
            Add a description…
          </button>
        )
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="username"
            className="rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint"
          />
          {nameError && <p className="text-xs text-red-400">{nameError}</p>}
          <textarea
            value={bioDraft}
            onChange={(e) => setBioDraft(e.target.value)}
            placeholder="Describe yourself — favorite genres, what you're bingeing…"
            rows={3}
            maxLength={200}
            className="resize-none rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint"
          />
          <div className="flex gap-2">
            <button
              onClick={saveEdits}
              className="rounded-full bg-accent px-4 py-1.5 font-display text-xs font-bold text-bg"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-full bg-surface px-4 py-1.5 font-display text-xs font-bold text-ink-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- top 10 shows ---- */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Top 10 shows</h2>
          <button onClick={() => setEditShows((v) => !v)} className="text-xs font-medium text-accent">
            {editShows ? 'Done' : 'Edit'}
          </button>
        </div>

        {profile.top10Shows.length === 0 && !editShows && (
          <p className="mt-2 text-sm text-ink-faint">Tap Edit to rank your all-time favorites.</p>
        )}

        <ol className="mt-3 flex flex-col gap-2">
          {profile.top10Shows.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface p-2">
              <span className="w-6 text-center font-display text-sm font-bold text-accent tabular-nums">
                {i + 1}
              </span>
              <Poster src={s.image} alt="" className="h-12 w-8 flex-none rounded" />
              <Link to={`/show/${s.id}`} className="min-w-0 flex-1 truncate text-sm font-medium">
                {s.name}
              </Link>
              {editShows && (
                <span className="flex flex-none gap-1">
                  <button onClick={() => setTop10Shows(move(profile.top10Shows, i, -1))} aria-label="Move up" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowUpIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Shows(move(profile.top10Shows, i, 1))} aria-label="Move down" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowDownIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Shows(profile.top10Shows.filter((x) => x.id !== s.id))} aria-label="Remove" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><XIcon className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </li>
          ))}
        </ol>

        {editShows && profile.top10Shows.length < 10 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-faint">
              {profile.top10Shows.length === 0
                ? 'Add your first show:'
                : 'Add a show — a quick head-to-head finds its spot:'}
            </p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
              {tracked
                .filter((t) => !profile.top10Shows.some((s) => s.id === t.id))
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() =>
                      profile.top10Shows.length === 0
                        ? setTop10Shows([{ id: t.id, name: t.name, image: t.image }])
                        : navigate(`/rank/${t.id}`)
                    }
                    className="w-16 flex-none text-left"
                  >
                    <span className="relative block">
                      <Poster src={t.image} alt={t.name} className="h-22 w-16 rounded-lg" />
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-bg">
                        <PlusIcon className="h-3 w-3" />
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[0.6rem] text-ink-soft">{t.name}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* ---- top 10 episodes ---- */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Top 10 episodes</h2>
          <button onClick={() => setEditEpisodes((v) => !v)} className="text-xs font-medium text-accent">
            {editEpisodes ? 'Done' : 'Edit'}
          </button>
        </div>

        {profile.top10Episodes.length === 0 && !editEpisodes && (
          <p className="mt-2 text-sm text-ink-faint">The single greatest hours of television, ranked by you.</p>
        )}

        <ol className="mt-3 flex flex-col gap-2">
          {profile.top10Episodes.map((e, i) => (
            <li key={e.id} className="flex items-center gap-3 rounded-xl bg-surface p-2">
              <span className="w-6 text-center font-display text-sm font-bold text-accent tabular-nums">
                {i + 1}
              </span>
              <Poster src={e.image} alt="" className="h-12 w-8 flex-none rounded" />
              <Link to={`/show/${e.showId}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{e.name}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {e.showName} · <span className="text-accent">{e.code}</span>
                </span>
              </Link>
              {editEpisodes && (
                <span className="flex flex-none gap-1">
                  <button onClick={() => setTop10Episodes(move(profile.top10Episodes, i, -1))} aria-label="Move up" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowUpIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Episodes(move(profile.top10Episodes, i, 1))} aria-label="Move down" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowDownIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Episodes(profile.top10Episodes.filter((x) => x.id !== e.id))} aria-label="Remove" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><XIcon className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </li>
          ))}
        </ol>

        {editEpisodes && profile.top10Episodes.length < 10 && <EpisodePicker />}
      </section>

      {/* ---- top 10 movies ---- */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Top 10 movies</h2>
          <button onClick={() => setEditMovies((v) => !v)} className="text-xs font-medium text-accent">
            {editMovies ? 'Done' : 'Edit'}
          </button>
        </div>

        {profile.top10Movies.length === 0 && !editMovies && (
          <p className="mt-2 text-sm text-ink-faint">
            {moviesWatched.length > 0
              ? 'Tap Edit to rank the movies you love.'
              : 'Mark movies watched, then rank your favorites here.'}
          </p>
        )}

        <ol className="mt-3 flex flex-col gap-2">
          {profile.top10Movies.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl bg-surface p-2">
              <span className="w-6 text-center font-display text-sm font-bold text-accent tabular-nums">
                {i + 1}
              </span>
              <Poster src={m.image} alt="" kind="movie" className="h-12 w-8 flex-none rounded" />
              <Link to={`/movie/${m.id}`} className="min-w-0 flex-1 truncate text-sm font-medium">
                {m.name}
              </Link>
              {editMovies && (
                <span className="flex flex-none gap-1">
                  <button onClick={() => setTop10Movies(move(profile.top10Movies, i, -1))} aria-label="Move up" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowUpIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Movies(move(profile.top10Movies, i, 1))} aria-label="Move down" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><ArrowDownIcon className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setTop10Movies(profile.top10Movies.filter((x) => x.id !== m.id))} aria-label="Remove" className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-ink-soft"><XIcon className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </li>
          ))}
        </ol>

        {editMovies && profile.top10Movies.length < 10 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-faint">
              {moviesWatched.length === 0 ? (
                <>No watched movies yet — <Link to="/search" className="text-accent">find one</Link> and mark it watched.</>
              ) : profile.top10Movies.length === 0 ? (
                'Add your first movie:'
              ) : (
                'Add a movie — a quick head-to-head finds its spot:'
              )}
            </p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
              {moviesWatched
                .filter((m) => !profile.top10Movies.some((t) => t.id === m.id))
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      profile.top10Movies.length === 0
                        ? setTop10Movies([{ id: m.id, name: m.title, image: m.poster }])
                        : navigate(`/rank/movie/${m.id}`)
                    }
                    className="w-16 flex-none text-left"
                  >
                    <span className="relative block">
                      <Poster src={m.poster} alt={m.title} kind="movie" className="h-22 w-16 rounded-lg" />
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-bg">
                        <PlusIcon className="h-3 w-3" />
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[0.6rem] text-ink-soft">{m.title}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* ---- saved shows ---- */}
      <section className="mt-8">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Saved shows</h2>
        {tracked.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">
            Nothing saved yet — <Link to="/search" className="text-accent">find your shows</Link>.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2.5">
            {tracked.map((t) => (
              <Link key={t.id} to={`/show/${t.id}`}>
                <Poster src={t.image} alt={t.name} className="aspect-[2/3] w-full rounded-lg" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ---- movies ---- */}
      <section className="mt-8">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Movies</h2>
        {movieList.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">
            Nothing yet — <Link to="/search" className="text-accent">find a movie</Link> to watch or log one
            you've seen.
          </p>
        ) : (
          <>
            {moviesWanted.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium text-ink-faint">Want to watch</p>
                <div className="mt-2 flex gap-2.5 overflow-x-auto pb-2">
                  {moviesWanted.map((m) => (
                    <Link key={m.id} to={`/movie/${m.id}`} className="w-20 flex-none">
                      <Poster src={m.poster} alt={m.title} kind="movie" className="aspect-[2/3] w-full rounded-lg" />
                      <span className="mt-1 block truncate text-[0.62rem] text-ink-soft">{m.title}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {moviesWatched.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium text-ink-faint">Watched · {moviesWatched.length}</p>
                <div className="mt-2 grid grid-cols-4 gap-2.5">
                  {moviesWatched.map((m) => (
                    <Link key={m.id} to={`/movie/${m.id}`}>
                      <Poster src={m.poster} alt={m.title} kind="movie" className="aspect-[2/3] w-full rounded-lg" />
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** Pick a show you track, then one of its aired episodes. */
function EpisodePicker() {
  const { shows } = useLibrary()
  const profile = useProfile()
  const [showId, setShowId] = useState<number | ''>('')
  const { data: show } = useShow(typeof showId === 'number' ? showId : 0)

  const aired = useMemo(
    () => (showId && show ? (show._embedded?.episodes ?? []).filter((ep) => hasAired(ep)) : []),
    [show, showId],
  )
  const tracked = Object.values(shows)

  function addEpisode(epId: number) {
    if (!show) return
    const ep = aired.find((e) => e.id === epId)
    if (!ep) return
    const entry: Top10Episode = {
      id: ep.id,
      showId: show.id,
      showName: show.name,
      code: epCode(ep),
      name: ep.name,
      image: show.image?.medium ?? null,
    }
    if (profile.top10Episodes.some((e) => e.id === entry.id)) return
    setTop10Episodes([...profile.top10Episodes, entry])
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <select
        value={showId}
        onChange={(e) => setShowId(e.target.value ? Number(e.target.value) : '')}
        className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink outline-none"
      >
        <option value="">Pick a show…</option>
        {tracked.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {showId !== '' && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) addEpisode(Number(e.target.value))
            e.target.value = ''
          }}
          className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink outline-none"
        >
          <option value="">Add an episode…</option>
          {aired.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {epCode(ep)} · {ep.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
