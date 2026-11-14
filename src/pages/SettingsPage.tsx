import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMyErrorReports } from '../queries'
import { agoLabel } from '../lib/time'
import { useBack } from '../lib/useBack'
import { hasBuiltInTmdbKey, updateSettings, useSettings } from '../store/settings'
import { tmdbKeyWorks } from '../api/tmdb'
import { backendReady } from '../lib/supabase'
import { deleteAccount, signOut, useSession } from '../store/session'
import { ChevronLeftIcon } from '../components/icons'

/** App settings: connections and account. Identity stuff stays on Profile. */
export function SettingsPage() {
  const goBack = useBack('/profile')
  const { session, profileStatus } = useSession()
  const signedIn = !!session && profileStatus === 'ready'

  return (
    <div className="px-4 pt-4">
      <button
        onClick={goBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Settings</h1>

      <SpoilerControl />

      <TmdbConnect />

      <section className="mt-8">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Account</h2>
        {signedIn ? (
          <AccountControls email={session?.user.email ?? ''} />
        ) : (
          <div className="mt-3 rounded-xl bg-surface p-3.5">
            <p className="text-xs text-ink-soft">
              {backendReady
                ? 'Not signed in — your tracking lives on this device only.'
                : 'Accounts arrive when the backend is configured.'}
            </p>
            {backendReady && (
              <Link
                to="/auth"
                className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-4 font-display text-xs font-bold text-bg"
              >
                Sign in / Create account
              </Link>
            )}
          </div>
        )}
      </section>

      {signedIn && <Diagnostics uid={session!.user.id} />}

      {/* required data attributions — see TMDB API terms and TVmaze (CC BY-SA) */}
      <section className="mt-8">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">About</h2>
        <div className="mt-3 rounded-xl bg-surface p-3.5 text-xs leading-relaxed text-ink-soft">
          <p>
            TV data by{' '}
            <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer" className="font-medium text-accent">
              TVmaze
            </a>{' '}
            (CC BY-SA).
          </p>
          <p className="mt-1.5">
            This product uses the{' '}
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="font-medium text-accent">
              TMDB
            </a>{' '}
            API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </section>
    </div>
  )
}

/**
 * What the app has reported about crashes on this account. Shown because
 * anything sent on someone's behalf should be visible to them — and because
 * it answers "did that get logged?" without opening a database.
 */
function Diagnostics({ uid }: { uid: string }) {
  const { data: reports } = useMyErrorReports(uid)
  if (!reports || reports.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Diagnostics</h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        Crashes MrWatch reported from your account, so they can be fixed. No page content and
        no one's name — just what broke and on which screen.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {reports.map((r) => (
          <div key={r.id} className="rounded-xl bg-surface p-3">
            <p className="flex items-baseline justify-between gap-2 text-[0.6875rem] font-bold uppercase tracking-wider">
              <span className="text-accent">{r.kind}</span>
              <span className="font-medium normal-case tracking-normal text-ink-faint">
                {r.route ?? '—'} · {agoLabel(new Date(r.created_at))}
              </span>
            </p>
            <p className="mt-1 break-words text-xs text-ink-soft">{r.message}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The one setting behind spoiler-gating: on by default, off for the fearless. */
function SpoilerControl() {
  const { spoilerGuard } = useSettings()
  return (
    <section className="mt-8">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Spoilers</h2>
      <div className="mt-3 rounded-xl bg-surface p-3.5">
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block font-display text-sm font-bold">Spoiler guard</span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
              Hide episode titles and posts that run ahead of where you are in a show. Tap
              anything hidden to reveal it. Shows you don't track are never hidden.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={spoilerGuard}
            onChange={(e) => updateSettings({ spoilerGuard: e.target.checked })}
            aria-label="Spoiler guard"
            className="mt-1 h-6 w-6 flex-none accent-accent"
          />
        </label>
      </div>
    </section>
  )
}

/** Signed-in account controls: sign out and (permanent) deletion. */
function AccountControls({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      const err = await deleteAccount()
      // on success the session ends and this whole panel unmounts
      if (err) {
        setError(err)
        setDeleting(false)
      }
    } catch {
      setError('Couldn’t delete the account — check your connection and try again.')
      setDeleting(false)
    }
  }

  async function handleSignOut() {
    if ((await signOut()) !== 'unsynced') return
    const lose = window.confirm(
      'Some of your recent changes could not be saved to your account yet (are you offline?). ' +
        'Signing out now erases them from this device for good. Sign out anyway?',
    )
    if (lose) await signOut(true)
  }

  return (
    <div className="mt-3 rounded-xl bg-surface p-3.5">
      <p className="text-xs text-ink-soft">Signed in as {email || 'your account'} — syncing across devices.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleSignOut()}
          disabled={deleting}
          className="min-h-11 rounded-full bg-raised px-4 font-display text-xs font-bold text-ink-soft disabled:opacity-40"
        >
          Sign out
        </button>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="-mx-2 min-h-11 px-2 text-xs font-medium text-red-400"
          >
            Delete account
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 rounded-xl border border-red-400/30 p-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            This permanently deletes your account, history, ratings, and posts. It can't be undone.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="min-h-11 rounded-full bg-red-400/15 px-4 font-display text-xs font-bold text-red-400 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Permanently delete everything'}
            </button>
            <button
              onClick={() => {
                setConfirming(false)
                setError(null)
              }}
              disabled={deleting}
              className="min-h-11 rounded-full bg-raised px-4 font-display text-xs font-bold text-ink-soft disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}

/** TMDB key entry — unlocks movies (search, tracking, recs) + "fans also watch". */
function TmdbConnect() {
  const { tmdbKey } = useSettings()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'bad'>('idle')

  async function connect() {
    const key = draft.trim()
    if (!key) return
    setStatus('checking')
    if (await tmdbKeyWorks(key)) {
      updateSettings({ tmdbKey: key })
      setDraft('')
      setStatus('idle')
    } else {
      setStatus('bad')
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em]">Connections</h2>
      {tmdbKey ? (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-surface p-3.5">
          <div>
            <p className="font-display text-sm font-bold">TMDB</p>
            <p className="text-xs text-good">Connected — movies and "fans also watch" are live</p>
          </div>
          <button
            onClick={() => updateSettings({ tmdbKey: '' })}
            className="-m-2 min-h-11 p-2 text-xs font-medium text-ink-faint"
          >
            Disconnect
          </button>
        </div>
      ) : hasBuiltInTmdbKey ? (
        <div className="mt-3 rounded-xl bg-surface p-3.5">
          <p className="font-display text-sm font-bold">TMDB</p>
          <p className="text-xs text-good">Included with MrWatch — movies and "fans also watch" are live</p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-surface p-3.5">
          <p className="font-display text-sm font-bold">TMDB</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Unlocks movies — search, your watchlist, Top 10 — plus "fans of your shows also
            watch". Create a free API key at themoviedb.org → Settings → API, then paste it here.
            It's stored on this device only.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void connect()
            }}
            className="mt-2 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setStatus('idle')
              }}
              name="tmdb-key"
              aria-label="TMDB API key"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="TMDB API key"
              className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-xs outline-none placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!draft.trim() || status === 'checking'}
              className="min-h-11 rounded-full bg-accent px-4 font-display text-xs font-bold text-bg disabled:opacity-40"
            >
              {status === 'checking' ? 'Checking…' : 'Connect'}
            </button>
          </form>
          {status === 'bad' && (
            <p role="alert" className="mt-1.5 text-xs text-red-400">
              TMDB rejected that key — double-check it and try again.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
