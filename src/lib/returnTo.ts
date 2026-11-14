/**
 * Where to send someone after they sign in — so a friend who taps an invite
 * link lands on the profile they were invited to, not their own empty one.
 *
 * The value travels as `/auth?next=…` and is stashed here because the OAuth
 * and magic-link round trips both come back to a bare `/auth`. It is
 * attacker-controllable (anyone can craft the link), so it is validated when
 * written AND when read, and only ever handed to the in-app router.
 */

const KEY = 'mrwatch:returnTo'
const TTL_MS = 30 * 60 * 1000
const MAX_LENGTH = 512

function currentOrigin(): string {
  return window.location.origin
}

/** A same-origin, relative, non-auth path — or null. Never trust the raw value. */
export function safeReturnPath(
  raw: string | null | undefined,
  origin: string = currentOrigin(),
): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null
  // must be "/x…": rejects "https:…", "javascript:…", and protocol-relative
  // "//evil.com" (plus "/\evil.com", which browsers treat the same way)
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return null
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    // backslashes and control characters (tabs/newlines are stripped by URL
    // parsers, which could turn "/\t/evil.com" into "//evil.com")
    if (code === 0x5c || code < 0x20 || code === 0x7f) return null
  }
  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  // never bounce back into the sign-in screen
  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return null
  return url.pathname + url.search + url.hash
}

export function stashReturnPath(raw: string | null | undefined): void {
  const path = safeReturnPath(raw)
  if (!path) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }))
  } catch {
    // private mode / storage full — sign-in still works, it just lands on Profile
  }
}

export function readReturnPath(): string | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return null
    const { path, at } = stored as { path?: unknown; at?: unknown }
    if (typeof path !== 'string' || typeof at !== 'number') return null
    if (Date.now() - at > TTL_MS) return null
    return safeReturnPath(path) // storage is not a trust boundary — validate again
  } catch {
    return null
  }
}

export function clearReturnPath(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
