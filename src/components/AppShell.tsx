import { Component, useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

/**
 * Crash + navigation safety net. In installed (standalone) mode there is no
 * refresh button, so a render crash must offer its own way out.
 */

export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[mrwatch] render crash', error)
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-lg font-bold">Something broke on this screen.</p>
        <p className="mt-2 text-sm text-ink-soft">
          Your shows and movies are safe — this is just a display hiccup.
        </p>
        <button
          onClick={() => {
            window.location.href = '/'
          }}
          className="mt-5 rounded-full bg-accent px-6 py-2.5 font-display text-sm font-bold text-bg"
        >
          Reload MrWatch
        </button>
      </div>
    )
  }
}

/** Unknown URLs get a real page instead of a silent blank. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
      <p className="font-display text-4xl font-bold text-accent">404</p>
      <p className="mt-2 font-display text-lg font-bold">Nothing plays here.</p>
      <p className="mt-1 text-sm text-ink-soft">
        That link doesn't match any screen — it may be old or mistyped.
      </p>
      <Link
        to="/"
        className="mt-5 rounded-full bg-accent px-6 py-2.5 font-display text-sm font-bold text-bg"
      >
        Back to Up Next
      </Link>
    </div>
  )
}

/** New screen, start at the top — like a native app, not a scrolled document. */
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
