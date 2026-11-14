import { useNavigate } from 'react-router-dom'

/**
 * Back that always goes somewhere. A shared link, a notification, or a cold
 * launch of the installed app opens a screen with no history behind it —
 * there `navigate(-1)` does nothing (or leaves the app entirely), so fall
 * back to a sensible parent screen instead.
 */
export function useBack(fallback = '/'): () => void {
  const navigate = useNavigate()
  return () => {
    // the router numbers its own history entries; 0 = first screen of this visit
    const idx = (window.history.state as { idx?: unknown } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
}
