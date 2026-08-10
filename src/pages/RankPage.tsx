import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { setTop10Shows, useProfile, type Top10Show } from '../store/profile'
import { Poster } from '../components/Poster'
import { ChevronLeftIcon } from '../components/icons'

const MAX_RANKED = 10

/**
 * The Ladder: place a show in your Top 10 by answering head-to-head
 * questions. Binary insertion — at most ~log2(10) comparisons.
 */
export function RankPage() {
  const { id } = useParams()
  const showId = Number(id)
  const navigate = useNavigate()
  const { shows } = useLibrary()
  const profile = useProfile()

  const entry = shows[showId]

  // Freeze the starting ladder (minus this show, so re-ranking works).
  const [ladder] = useState<Top10Show[]>(() =>
    profile.top10Shows.filter((s) => s.id !== showId),
  )
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
    next.splice(lo, 0, { id: entry.id, name: entry.name, image: entry.image })
    setTop10Shows(next)
    setPlaced(lo)
  }, [lo, hi, placed, entry, ladder])

  if (!entry) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">You can only rank shows you track.</p>
        <Link to={`/show/${showId}`} className="mt-3 inline-block text-sm text-accent">
          Back to the show
        </Link>
      </div>
    )
  }

  // ---- finished ----
  if (placed !== null) {
    const madeIt = placed < MAX_RANKED
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4 text-center">
        <Poster src={entry.image} alt="" className="h-44 w-30 rounded-xl" />
        {madeIt ? (
          <>
            <p className="mt-5 font-display text-4xl font-bold text-accent">#{placed + 1}</p>
            <p className="mt-1 font-display text-lg font-bold">{entry.name}</p>
            <p className="mt-1 text-sm text-ink-soft">
              in your Top {Math.min(ladder.length + 1, MAX_RANKED)}
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
        Which show do you rate higher?
      </h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {[
          { show: { id: entry.id, name: entry.name, image: entry.image }, better: () => setHi(mid) },
          { show: rival, better: () => setLo(mid + 1) },
        ].map(({ show, better }) => (
          <button
            key={show.id}
            onClick={better}
            className="group flex flex-col items-center gap-2 rounded-2xl bg-surface p-3 transition-transform active:scale-95"
          >
            <Poster src={show.image} alt="" className="aspect-[2/3] w-full rounded-xl" />
            <span className="line-clamp-2 text-center font-display text-sm font-bold">
              {show.name}
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
