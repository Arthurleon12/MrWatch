import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hasBuiltInTmdbKey, updateSettings, useSettings } from '../store/settings'
import { tmdbKeyWorks } from '../api/tmdb'
import { backendReady } from '../lib/supabase'
import { deleteAccount, signOut, useSession } from '../store/session'
import { ChevronLeftIcon } from '../components/icons'

/** App settings: connections and account. Identity stuff stays on Profile. */
export function SettingsPage() {
  const navigate = useNavigate()
  const { session, profileStatus } = useSession()
  const signedIn = !!session && profileStatus === 'ready'

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Settings</h1>

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
                className="mt-3 inline-block rounded-full bg-accent px-4 py-2 font-display text-xs font-bold text-bg"
              >
                Sign in / Create account
              </Link>
            )}
          </div>
        )}
      </section>

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

/** Signed-in account controls: sign out and (permanent) deletion. */
function AccountControls({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-3 rounded-xl bg-surface p-3.5">
      <p className="text-xs text-ink-soft">Signed in as {email || 'your account'} — syncing across devices.</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void signOut()}
          className="rounded-full bg-raised px-4 py-2 font-display text-xs font-bold text-ink-soft"
        >
          Sign out
        </button>
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="text-xs font-medium text-red-400">
            Delete account
          </button>
        ) : (
          <button
            onClick={async () => {
              const err = await deleteAccount()
              if (err) setError(err)
            }}
            className="rounded-full bg-red-400/15 px-4 py-2 font-display text-xs font-bold text-red-400"
          >
            Permanently delete everything?
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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
            className="text-xs font-medium text-ink-faint"
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
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setStatus('idle')
              }}
              placeholder="TMDB API key"
              className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-xs outline-none placeholder:text-ink-faint"
            />
            <button
              onClick={connect}
              disabled={!draft.trim() || status === 'checking'}
              className="rounded-full bg-accent px-4 py-2 font-display text-xs font-bold text-bg disabled:opacity-40"
            >
              {status === 'checking' ? 'Checking…' : 'Connect'}
            </button>
          </div>
          {status === 'bad' && (
            <p className="mt-1.5 text-xs text-red-400">
              TMDB rejected that key — double-check it and try again.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
