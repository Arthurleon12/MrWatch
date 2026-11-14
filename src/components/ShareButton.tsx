import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, ShareIcon } from './icons'

interface ShareButtonProps {
  /** in-app path, e.g. "/u/arthur" — the origin is added here */
  path: string
  title: string
  text?: string
  /** accessible name; also the visible text when `children` is not given a label */
  label?: string
  /** pass a visible label to get a pill instead of the round icon button */
  children?: ReactNode
  className?: string
}

/**
 * Native share sheet where there is one (iOS, Android), copy-to-clipboard
 * everywhere else. Cancelling the sheet is not an error.
 */
export function ShareButton({ path, title, text, label = 'Share', children, className }: ShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function flash(next: 'copied' | 'failed') {
    setStatus(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 2200)
  }

  async function share() {
    const url = `${window.location.origin}${path}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text, url })
        return
      }
      await navigator.clipboard.writeText(url)
      flash('copied')
    } catch (error) {
      // the person closed the share sheet — nothing went wrong
      if (error instanceof DOMException && error.name === 'AbortError') return
      flash('failed')
    }
  }

  const message = status === 'copied' ? 'Link copied' : status === 'failed' ? "Couldn't share" : ''
  const Icon = status === 'copied' ? CheckIcon : ShareIcon

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={children ? undefined : label}
      className={
        className ??
        (children
          ? 'inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 font-display text-xs font-bold text-bg'
          : 'flex h-11 w-11 flex-none items-center justify-center rounded-full bg-surface text-ink-soft')
      }
    >
      <Icon className={children ? 'h-4 w-4' : 'h-5 w-5'} />
      {children && <span>{status === 'idle' ? children : message}</span>}
      <span role="status" className="sr-only">
        {message}
      </span>
    </button>
  )
}
