import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { useMovies } from '../store/movies'
import {
  setTop10Movies,
  setTop10Shows,
  useProfile,
  type Top10Show,
} from '../store/profile'
import { Poster } from '../components/Poster'
import { ChevronLeftIcon } from '../components/icons'

const MAX_RANKED = 10

type Kind = 'show' | 'movie'

/**
 * The Ladder: place a show or movie in your Top 10 by answering head-to-head
 * questions. Binary insertion — at most ~log2(10) comparisons.
 */
export function RankPage({ kind }: { kind: Kind }) {
  const { id } = useParams()
  const itemId = Number(id)
  const navigate = useNavigate()
  const { shows } = useLibrary()
  const { movies } = useMovies()
  const profile = useProfile()

  const entry: Top10Show | null =
    kind === 'show'
      ? shows[itemId]
        ? { id: itemId, name: shows[itemId].name, image: shows[itemId].image }
        : null
      : movies[itemId]?.status === 'watched'
        ? { id: itemId, name: movies[itemId].title, image: movies[itemId].poster }
        : null

  const fullLadder = kind === 'show' ? profile.top10Shows : profile.top10Movies
  const saveLadder = kind === 'show' ? setTop10Shows : setTop10Movies
  const itemPath = kind === 'show' ? `/show/${itemId}` : `/movie/${itemId}`
  const noun = kind === 'show' ? 'show' : 'movie'

  // Freeze the starting ladder (minus this item, so re-ranking works).
  const [ladder] = useState<Top10Show[]>(() => fullLadder.filter((s) => s.id !== itemId))
  const [lo, setLo] = useState(0)
  const [hi, setHi] = useState(ladder.length)
  const [placed, setPlaced] = useState<number | null>(null)

  useEffect(() => {
    if (!entry || placed !== null || lo < hi) return
    // converged: insert at position `lo`
    if (lo >= MAX_RANKED) {
      setPlaced(lo) // didn't crack the Top 10 — nothing saved
      return
    }
    const next = [...ladder]
    next.splice(lo, 0, entry)
    saveLadder(next)
    setPlaced(lo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi, placed, ladder])

  if (!entry) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">
          {kind === 'show'
            ? 'You can only rank shows you track.'
            : 'You can only rank movies you’ve watched.'}
        </p>
        <Link to={itemPath} className="mt-3 inline-block text-sm text-accent">
          Back to the {noun}
        </Link>
      </div>
    )
  }

  // ---- finished ----
  if (placed !== null) {
    const madeIt = placed < MAX_RANKED
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4 text-center">
        <Poster src={entry.image} alt="" kind={kind === 'movie' ? 'movie' : 'tv'} className="h-44 w-30 rounded-xl" />
        {madeIt ? (
          <>
            <p className="mt-5 font-display text-4xl font-bold text-accent">#{placed + 1}</p>
            <p className="mt-1 font-display text-lg font-bold">{entry.name}</p>
            <p className="mt-1 text-sm text-ink-soft">
              in your Top {Math.min(ladder.length + 1, MAX_RANKED)} {noun}s
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 font-display text-lg font-bold">{entry.name}</p>
            <p className="mt-1 max-w-60 text-sm text-ink-soft">
              Doesn't crack your Top 10 — for now.
            </p>
          </>
        )}
        <div className="mt-6 flex gap-3">
          <Link
            to="/profile"
            className="rounded-full bg-accent px-5 py-2.5 font-display text-xs font-bold text-bg"
          >
            See your Top 10
          </Link>
          <button
            onClick={() => navigate(-1)}
            className="rounded-full bg-surface px-5 py-2.5 font-display text-xs font-bold text-ink-soft"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // converged but not saved yet (e.g. first paint with an empty ladder):
  // the effect places it immediately — skip the one frame with no rival
  if (lo >= hi) return null

  // ---- comparing ----
  const mid = Math.floor((lo + hi) / 2)
  const rival = ladder[mid]

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Cancel ranking"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      <h1 className="mt-4 text-center font-display text-xl font-bold" style={{ textWrap: 'balance' }}>
        Which {noun} do you rate higher?
      </h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {[
          { item: entry, better: () => setHi(mid) },
          { item: rival, better: () => setLo(mid + 1) },
        ].map(({ item, better }) => (
          <button
            key={item.id}
            onClick={better}
            className="group flex flex-col items-center gap-2 rounded-2xl bg-surface p-3 transition-transform active:scale-95"
          >
            <Poster src={item.image} alt="" kind={kind === 'movie' ? 'movie' : 'tv'} className="aspect-[2/3] w-full rounded-xl" />
            <span className="line-clamp-2 text-center font-display text-sm font-bold">
              {item.name}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-ink-faint">
        A few taps and {entry.name} finds its place in your Top 10.
      </p>
    </div>
  )
}
