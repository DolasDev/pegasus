import type { SupportContext } from '@/api/queries/support'

// ---------------------------------------------------------------------------
// Browser context attached to a new support thread, so Steve sees where the
// user was when they asked. Help is its own page, so "where they were" is the
// last page they visited that is not /support: router.tsx feeds every resolved
// navigation to `rememberPage`.
//
// No app version: tenant-web has no build id baked in yet; the API treats it as
// optional.
// ---------------------------------------------------------------------------

let lastPage: string | null = null

export function isSupportPath(pathname: string): boolean {
  return pathname === '/support' || pathname.startsWith('/support/')
}

/**
 * Pages never worth attaching: sign-in (the callback URL carries a one-time
 * code) and the public token links (crew link, feedback form), whose token
 * would otherwise be stored on the thread and shown in admin-web.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/f/') ||
    pathname === '/landing'
  )
}

/** Records a visited page (a full URL); support and public pages are skipped. */
export function rememberPage(href: string): void {
  try {
    const { pathname } = new URL(href)
    if (!isSupportPath(pathname) && !isPublicPath(pathname)) lastPage = href
  } catch {
    // Not a URL: ignore.
  }
}

/** The page to attach: the last non-support page, else the current one. */
export function supportContext(): SupportContext {
  const ctx: SupportContext = {}
  const page = lastPage ?? (typeof window !== 'undefined' ? window.location.href : null)
  if (page) ctx.pageUrl = page
  if (typeof navigator !== 'undefined' && navigator.userAgent) ctx.userAgent = navigator.userAgent
  return ctx
}

/** Test seam. */
export function resetRememberedPage(): void {
  lastPage = null
}
