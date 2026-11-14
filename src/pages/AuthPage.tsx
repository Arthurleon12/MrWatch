import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { backendReady, supabase } from '../lib/supabase'
import {
  markProfileClaimed,
  signInWithEmail,
  signInWithProvider,
  verifyEmailCode,
  useSession,
} from '../store/session'
import { getProfileState, updateProfile, validateUsername } from '../store/profile'
import { clearReturnPath, readReturnPath, safeReturnPath, stashReturnPath } from '../lib/returnTo'
import { PageSkeleton } from '../components/AppShell'

// Apple stays hidden until the provider is configured in Supabase — a live
// button that dead-ends on an error page is worse than no button.
const APPLE_LOGIN_READY = ((import.meta.env.VITE_APPLE_LOGIN as string | undefined) ?? '') === '1'

export function AuthPage() {
  const { session, profileStatus, initializing } = useSession()
  const [params] = useSearchParams()
  const next = params.get('next')

  // The screen that sent the visitor here. Stashed (after validation) because
  // the OAuth and magic-link round trips both return to a bare /auth.
  // (Not once signed in and set up: by then the redirect below has consumed
  // and cleared it, and stashing again would leak into the next sign-in.)
  const settled = !!session && profileStatus === 'ready'
  useEffect(() => {
    if (!settled) stashReturnPath(next)
  }, [next, settled])

  if (!backendReady) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
        <img src="/logo-wordmark.png" alt="MrWatch" className="h-7 w-auto" />
        <h1 className="mt-4 font-display text-xl font-bold">MrWatch is in local mode</h1>
        <p className="mt-2 max-w-70 text-sm leading-relaxed text-ink-soft">
          Accounts aren't configured yet. Follow SETUP.md to connect Supabase, then this screen
          becomes sign-in for you, friends, and family.
        </p>
        <Link to="/" className="mt-5 text-sm font-bold text-accent">Back to the app</Link>
      </div>
    )
  }

  if (initializing) return <PageSkeleton />

  // signed in, but we don't yet know whether a username exists — showing the
  // sign-in form here made people tap "Continue with Google" a second time
  if (session && profileStatus === 'unknown') return <PageSkeleton />
  if (settled) return <ReturnRedirect next={next} />
  if (session && profileStatus === 'missing') return <ClaimUsername />

  return <SignIn />
}

/** Signed in and set up: back to the screen that asked for sign-in, else Profile. */
function ReturnRedirect({ next }: { next: string | null }) {
  // read once — the effect below clears it, and a re-render must not change the target.
  // ?next= on this very URL wins (code sign-in never leaves the page); the stash
  // covers the OAuth / magic-link return, which arrives without it.
  const [to] = useState(() => safeReturnPath(next) ?? readReturnPath() ?? '/profile')
  useEffect(() => {
    clearReturnPath()
  }, [])
  return <Navigate to={to} replace />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailReady = email.includes('@')
  const codeReady = code.trim().length >= 6

  async function startProvider(provider: 'google' | 'apple') {
    setError(null)
    const err = await signInWithProvider(provider)
    if (err) setError(err)
  }

  async function sendLink(event: FormEvent) {
    event.preventDefault()
    if (!emailReady || sending) return
    setSending(true)
    setError(null)
    try {
      const err = await signInWithEmail(email.trim())
      if (err) setError(err)
      else setSent(true)
    } catch {
      setError('Couldn’t send the email — check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    if (!codeReady || checking) return
    setChecking(true)
    setError(null)
    try {
      const err = await verifyEmailCode(email.trim(), code)
      if (err) setError(err.includes('expired') || err.includes('invalid') ? 'That code didn’t match — check the email and try again.' : err)
      // success: the auth listener takes over and this screen navigates away
    } catch {
      setError('Couldn’t check the code — check your connection and try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center px-6">
      <div className="text-center">
        <img src="/logo-wordmark.png" alt="MrWatch" className="mx-auto h-9 w-auto" />
        <p className="mt-3 text-sm text-ink-soft">
          Track your shows and movies. Never miss an episode. Bring your friends.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void startProvider('google')}
          className="rounded-full bg-ink py-3 font-display text-sm font-bold text-bg"
        >
          Continue with Google
        </button>
        {APPLE_LOGIN_READY && (
          <button
            type="button"
            onClick={() => void startProvider('apple')}
            className="rounded-full bg-ink py-3 font-display text-sm font-bold text-bg"
          >
            Continue with Apple
          </button>
        )}

        <div className="my-2 flex items-center gap-3 text-[0.6875rem] uppercase tracking-widest text-ink-faint">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        {sent ? (
          <form onSubmit={submitCode} className="flex flex-col gap-2">
            <p id="code-help" className="text-center text-sm text-ink-soft">
              Check your email — tap the link, or type the code from the email here (best when
              MrWatch is on your home screen):
            </p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                aria-label="6-digit code"
                aria-describedby="code-help"
                placeholder="6-digit code"
                className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-center tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-ink-faint"
              />
              <button
                type="submit"
                disabled={!codeReady || checking}
                className="rounded-full bg-accent px-5 font-display text-sm font-bold text-bg disabled:opacity-40"
              >
                {checking ? '…' : 'Sign in'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={sendLink} className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Email address"
              placeholder="you@email.com"
              className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!emailReady || sending}
              className="rounded-full bg-accent px-5 font-display text-sm font-bold text-bg disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send link'}
            </button>
          </form>
        )}
        {error && <p role="alert" className="text-center text-xs text-red-400">{error}</p>}

        <p className="mt-3 text-center text-[0.6875rem] leading-relaxed text-ink-faint">
          Your on-device history moves into your account the first time you sign in.
        </p>
      </div>
    </div>
  )
}

/** First sign-in: claim a unique @username, seeded from the local profile. */
function ClaimUsername() {
  const { session } = useSession()
  const [name, setName] = useState(getProfileState().username)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function claim() {
    if (!supabase || !session) return
    const localErr = validateUsername(name)
    if (localErr) {
      setError(localErr)
      return
    }
    setSaving(true)
    setError(null)
    const local = getProfileState()
    const { error: dbError } = await supabase.from('profiles').insert({
      id: session.user.id,
      username: name,
      bio: local.bio,
      avatar_url: local.avatar,
      top10_shows: local.top10Shows,
      top10_episodes: local.top10Episodes,
    })
    setSaving(false)
    if (dbError) {
      if (dbError.code === '23505') setError('That username is taken — try another.')
      else if (dbError.message.includes('reserved')) setError('That username is reserved.')
      else setError(dbError.message)
      return
    }
    updateProfile({ username: name })
    await markProfileClaimed()
  }

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center px-6">
      <h1 className="font-display text-2xl font-bold">Pick your @username</h1>
      <p className="mt-1 text-sm text-ink-soft">
        It's how friends find and follow you. 3–20 characters; letters, numbers, underscores.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!saving && name.trim().length >= 3) void claim()
        }}
        className="flex flex-col"
      >
        <div className="mt-5 flex items-center gap-1 rounded-full bg-surface px-4">
          <span aria-hidden="true" className="text-ink-faint">@</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            autoFocus
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            enterKeyHint="done"
            aria-label="Username"
            placeholder="yourname"
            className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-ink-faint"
          />
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={saving || name.trim().length < 3}
          className="mt-4 rounded-full bg-accent py-3 font-display text-sm font-bold text-bg disabled:opacity-40"
        >
          {saving ? 'Claiming…' : 'Claim username'}
        </button>
      </form>
    </div>
  )
}
