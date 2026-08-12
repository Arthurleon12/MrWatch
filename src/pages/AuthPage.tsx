import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { backendReady, supabase } from '../lib/supabase'
import {
  markProfileClaimed,
  signInWithEmail,
  signInWithProvider,
  verifyEmailCode,
  useSession,
} from '../store/session'

// Apple stays hidden until the provider is configured in Supabase — a live
// button that dead-ends on an error page is worse than no button.
const APPLE_LOGIN_READY = ((import.meta.env.VITE_APPLE_LOGIN as string | undefined) ?? '') === '1'
import { getProfileState, updateProfile, validateUsername } from '../store/profile'

export function AuthPage() {
  const { session, profileStatus, initializing } = useSession()

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

  if (initializing) {
    return <div className="px-4 pt-10"><div className="h-40 animate-pulse rounded-xl bg-surface" /></div>
  }

  if (session && profileStatus === 'ready') return <Navigate to="/profile" replace />
  if (session && profileStatus === 'missing') return <ClaimUsername />

  return <SignIn />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendLink() {
    setError(null)
    const err = await signInWithEmail(email.trim())
    if (err) setError(err)
    else setSent(true)
  }

  async function submitCode() {
    setChecking(true)
    setError(null)
    const err = await verifyEmailCode(email.trim(), code)
    setChecking(false)
    if (err) setError(err.includes('expired') || err.includes('invalid') ? 'That code didn’t match — check the email and try again.' : err)
    // success: the auth listener takes over and this screen navigates away
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
          onClick={() => signInWithProvider('google')}
          className="rounded-full bg-ink py-3 font-display text-sm font-bold text-bg"
        >
          Continue with Google
        </button>
        {APPLE_LOGIN_READY && (
          <button
            onClick={() => signInWithProvider('apple')}
            className="rounded-full bg-ink py-3 font-display text-sm font-bold text-bg"
          >
            Continue with Apple
          </button>
        )}

        <div className="my-2 flex items-center gap-3 text-[0.65rem] uppercase tracking-widest text-ink-faint">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        {sent ? (
          <div className="flex flex-col gap-2">
            <p className="text-center text-sm text-ink-soft">
              Check your email — tap the link, or type the code from the email here (best when
              MrWatch is on your home screen):
            </p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-center tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-ink-faint"
              />
              <button
                onClick={submitCode}
                disabled={code.trim().length < 6 || checking}
                className="rounded-full bg-accent px-5 font-display text-sm font-bold text-bg disabled:opacity-40"
              >
                {checking ? '…' : 'Sign in'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@email.com"
              className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
            />
            <button
              onClick={sendLink}
              disabled={!email.includes('@')}
              className="rounded-full bg-accent px-5 font-display text-sm font-bold text-bg disabled:opacity-40"
            >
              Send link
            </button>
          </div>
        )}
        {error && <p className="text-center text-xs text-red-400">{error}</p>}

        <p className="mt-3 text-center text-[0.68rem] leading-relaxed text-ink-faint">
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
      <div className="mt-5 flex items-center gap-1 rounded-full bg-surface px-4">
        <span className="text-ink-faint">@</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          autoFocus
          placeholder="yourname"
          className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-ink-faint"
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={claim}
        disabled={saving || name.trim().length < 3}
        className="mt-4 rounded-full bg-accent py-3 font-display text-sm font-bold text-bg disabled:opacity-40"
      >
        {saving ? 'Claiming…' : 'Claim username'}
      </button>
    </div>
  )
}
