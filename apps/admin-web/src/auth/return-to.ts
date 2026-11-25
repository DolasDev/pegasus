// ---------------------------------------------------------------------------
// Where to go after signing in. The admin session lives in sessionStorage, so
// a link opened from an email (the support alert's "Open: …/support/<id>")
// lands in a fresh tab with no session. The auth guard remembers the page it
// bounced from; login and the Hosted UI callback send the user back there.
//
// Only a same-origin path is accepted ("/x", never "//host" or "https://…"),
// so the stored value can't turn the login page into an open redirect.
// ---------------------------------------------------------------------------

const KEY = 'pegasus_admin_return_to'
export const DEFAULT_AFTER_LOGIN = '/tenants'

/** A same-origin, non-login path, or null. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/auth/')) return null
  return raw
}

export function rememberReturnTo(path: string): void {
  const safe = safeReturnPath(path)
  if (!safe || safe === '/') return
  try {
    sessionStorage.setItem(KEY, safe)
  } catch {
    // Storage unavailable: the user lands on the default page instead.
  }
}

/** The remembered page (cleared once read), else the default landing page. */
export function takeReturnTo(): string {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    // Storage unavailable.
  }
  return safeReturnPath(raw) ?? DEFAULT_AFTER_LOGIN
}
