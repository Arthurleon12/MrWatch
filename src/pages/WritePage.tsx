import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { addArticle } from '../store/articles'
import { useProfile } from '../store/profile'
import { useShow } from '../queries'
import { epCode, hasAired } from '../lib/time'
import { ChevronLeftIcon } from '../components/icons'

export function WritePage() {
  const navigate = useNavigate()
  const { shows } = useLibrary()
  const profile = useProfile()

  const tracked = Object.values(shows).sort((a, b) => a.name.localeCompare(b.name))
  const [showId, setShowId] = useState<number | ''>('')
  const [epId, setEpId] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const { data: show } = useShow(typeof showId === 'number' ? showId : 0)
  const aired = useMemo(
    () => (show ? (show._embedded?.episodes ?? []).filter((ep) => hasAired(ep)) : []),
    [show],
  )

  const selected = typeof showId === 'number' ? tracked.find((t) => t.id === showId) : undefined
  const episode = typeof epId === 'number' ? aired.find((e) => e.id === epId) : undefined
  const canPublish = selected && title.trim().length >= 3 && body.trim().length >= 20

  function publish() {
    if (!selected) return
    const id = addArticle({
      title: title.trim(),
      body: body.trim(),
      author: profile.username || 'you',
      subject: {
        showId: selected.id,
        showName: selected.name,
        image: selected.image,
        epCode: episode ? epCode(episode) : undefined,
        epName: episode?.name,
      },
    })
    navigate(`/article/${id}`, { replace: true })
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

      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Write an article</h1>
      <p className="mt-1 text-sm text-ink-soft">
        A review, a theory, a ranking — always pinned to the show it's about.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-ink-faint">
            About which show?
          </span>
          <select
            value={showId}
            onChange={(e) => {
              setShowId(e.target.value ? Number(e.target.value) : '')
              setEpId('')
            }}
            className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink outline-none"
          >
            <option value="">Pick a show you track…</option>
            {tracked.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        {showId !== '' && (
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-xs font-bold uppercase tracking-wider text-ink-faint">
              A specific episode? <span className="normal-case text-ink-faint">(optional)</span>
            </span>
            <select
              value={epId}
              onChange={(e) => setEpId(e.target.value ? Number(e.target.value) : '')}
              className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink outline-none"
            >
              <option value="">Whole show</option>
              {aired.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {epCode(ep)} · {ep.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={120}
          className="rounded-lg bg-surface px-3 py-3 font-display text-base font-bold outline-none placeholder:font-normal placeholder:text-ink-faint"
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your take…"
          rows={10}
          className="resize-none rounded-lg bg-surface px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-ink-faint"
        />

        <button
          onClick={publish}
          disabled={!canPublish}
          className="rounded-full bg-accent py-3 font-display text-sm font-bold text-bg disabled:opacity-40"
        >
          Publish to your feed
        </button>
        {tracked.length === 0 && (
          <p className="text-center text-xs text-ink-faint">
            Track a show first — articles are always pinned to a show.
          </p>
        )}
      </div>
    </div>
  )
}
