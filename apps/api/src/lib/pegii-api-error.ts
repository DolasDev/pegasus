// ---------------------------------------------------------------------------
// PegiiApiError — the typed failure every pegII bridge call throws. Its own
// module so the client (pegii-api-client.ts) and the service-user login
// (pegii-auth.ts) can share it without importing each other.
// ---------------------------------------------------------------------------

export type PegiiApiErrorCode =
  | 'PEGII_API_NOT_CONFIGURED'
  | 'PEGII_API_TUNNEL_ERROR'
  | 'PEGII_API_HTTP_ERROR'
  | 'PEGII_API_BAD_ENVELOPE'
  /** The site rejected the service user's credentials, or a fresh token. */
  | 'PEGII_API_AUTH_FAILED'
  /** The site has no login (no Api:Jwt / hub DB, or an API build without auth). */
  | 'PEGII_API_AUTH_UNAVAILABLE'
  /** The site's /version does not advertise a capability this call needs. */
  | 'PEGII_API_CAPABILITY_MISSING'

export class PegiiApiError extends Error {
  readonly code: PegiiApiErrorCode
  /** Upstream HTTP status, when the failure came from a non-2xx response. */
  readonly status?: number
  /** The pegII envelope's own `code` (e.g. `VALIDATION_ERROR`), when it sent one. */
  readonly upstreamCode?: string
  constructor(code: PegiiApiErrorCode, message: string, status?: number, upstreamCode?: string) {
    super(message)
    this.code = code
    this.name = 'PegiiApiError'
    if (status !== undefined) this.status = status
    if (upstreamCode !== undefined) this.upstreamCode = upstreamCode
  }
}
