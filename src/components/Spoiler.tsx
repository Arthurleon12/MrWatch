import { useState, type ReactNode } from 'react'
import { EyeOffIcon } from './icons'

/**
 * Tap-to-reveal wrappers for anything that runs ahead of the viewer's own
 * progress. Both stop the click from reaching an enclosing link — revealing a
 * spoiler should never also navigate you somewhere.
 */

function useReveal() {
  const [revealed, setRevealed] = useState(false)
  const reveal = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    setRevealed(true)
  }
  return { revealed, reveal }
}

/** Inline text (an episode title, a headline) blurred until tapped. */
export function SpoilerText({ children, label = 'Hidden to avoid spoilers' }: {
  children: ReactNode
  label?: string
}) {
  const { revealed, reveal } = useReveal()
  if (revealed) return <>{children}</>
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${label} — reveal`}
      onClick={reveal}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') reveal(e)
      }}
      className="cursor-pointer select-none blur-[4.5px] transition-[filter] hover:blur-[3px]"
    >
      <span aria-hidden="true">{children}</span>
    </span>
  )
}

/** A block of content (an article body, a card preview) behind a labelled veil. */
export function SpoilerBlock({ children, epCode, className = '' }: {
  children: ReactNode
  /** the episode being spoiled, e.g. "S05E10" */
  epCode?: string
  className?: string
}) {
  const { revealed, reveal } = useReveal()
  if (revealed) return <>{children}</>
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Hidden${epCode ? ` — spoilers for ${epCode}` : ''} — reveal`}
      onClick={reveal}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') reveal(e)
      }}
      className={`flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-ink-faint active:border-accent active:text-accent ${className}`}
    >
      <EyeOffIcon className="h-3.5 w-3.5 flex-none" />
      <span className="text-xs font-medium">
        {epCode ? `Spoilers for ${epCode}` : 'Spoilers ahead of where you are'} · tap to show
      </span>
    </span>
  )
}
