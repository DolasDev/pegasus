import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Errors from actions that read a company's pegII directory through its site
// (Settings → Companies "Sync employees", Users → "Add from pegII"), phrased
// for the admin in terms of what to do about the site's state.
// ---------------------------------------------------------------------------

export function companySiteErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  switch (error.code) {
    case 'SITE_CLOUD_AUTH_DISABLED':
      return "Cloud auth isn't on for this company's site yet. It is enabled per site by your Pegasus administrator; try again after that."
    case 'PEGII_CAPABILITY_MISSING':
      return "This company's site runs a pegII API build without the employee directory. It updates itself; try again after the next update."
    case 'COMPANY_NOT_FOUND':
      return "The site has no database configured for this company's data source key (SpokeConnections)."
    case 'COMPANY_SCHEMA_UNAVAILABLE':
      return "This company's database failed its schema migration on the site. Fix it and restart the site's API."
    case 'PEGII_SOURCE_AUTH_FAILED':
      return 'The site rejected the cloud token. Check that cloud auth is configured on the site.'
    case 'SSO_NOT_CONFIGURED':
      return 'SSO-only users need an enabled SSO provider to sign in. Turn on "Send invite", or set up SSO first.'
    default:
      return error.message
  }
}
