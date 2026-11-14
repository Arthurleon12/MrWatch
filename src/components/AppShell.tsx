import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { reportError } from '../lib/report'

/**
 * Crash + navigation safety net. In installed (standalone) mode there is no
 * refresh button, so a render crash must offer its own way out.
 */

const CHUNK_RELOAD_KEY = 'mrwatch:chunk-reload'
const CHUNK_RELOAD_COOLDOWN_MS = 60 * 1000

/** A lazy route whose file is gone — the app was redeployed under an open session. */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|module script/i.test(
    message,
  )
}

/** Reload once to pick up the new build; the timestamp stops a reload loop. */
function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return false // no storage → can't guard against a loop → don't risk one
  }
  window.location.reload()
  return true
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadOnceForNewBuild()) return
    // the component stack is the useful half — it names the screen that broke
    reportError('render', error, { detail: info.componentStack ?? undefined })
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top,0px))] flex-col items-center justify-center px-8 text-center">
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

/** The placeholder every screen shows while it (or its code) loads. */
export function PageSkeleton() {
  return (
    <div className="px-4 pt-6" role="status" aria-label="Loading">
      <div className="h-40 animate-pulse rounded-xl bg-surface" />
    </div>
  )
}

/**
 * Sign-in is required here — go there, and remember this screen so the
 * visitor comes back to it afterwards (see lib/returnTo).
 */
export function AuthRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/auth?next=${encodeURIComponent(pathname + search)}`} replace />
}

/**
 * New screen, start at the top — like a native app, not a scrolled document.
 * Going BACK is different: you return to where you were, so the browser's
 * own scroll restoration is left alone.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [pathname, navigationType])
  return null
}
