// ---------------------------------------------------------------------------
// RingCentral auth — per-tenant JWT-bearer (bring-your-own credentials).
//
// Each tenant registers their OWN RingCentral app, enables JWT auth on it, and
// creates a JWT credential bound to that app. They paste the app's client id +
// client secret + the JWT into Pegasus. We exchange those, server-to-server, for
// a short-lived access token (RingCentral's `jwt-bearer` grant). There is no
// refresh token — the JWT is the durable credential; we re-present it whenever
// the cached access token expires. The per-connection credentials live in
// Secrets Manager (see lib/ringcentral-secrets.ts), never in Postgres.
// ---------------------------------------------------------------------------

export const DEFAULT_API_BASE = 'https://platform.ringcentral.com'

const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

/**
 * Platform-level config. With bring-your-own credentials there is no platform
 * client id/secret — only the default API base and the master enable switch.
 */
export interface RingCentralConfig {
  apiBase: string
}

/**
 * Returns the platform config, or null when the integration is disabled
 * (`RINGCENTRAL_ENABLED !== 'true'`), so the crons + connect endpoint fail
 * closed. `apiBase` is the default RingCentral environment used at connect time
 * when a tenant doesn't pin their own (sandbox vs production).
 */
export function readOAuthConfig(env: NodeJS.ProcessEnv = process.env): RingCentralConfig | null {
  if (env['RINGCENTRAL_ENABLED'] !== 'true') return null
  return { apiBase: env['RINGCENTRAL_API_BASE'] ?? DEFAULT_API_BASE }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A RingCentral OAuth/API error carrying the HTTP status, so callers can tell a
 * permanent failure (4xx — e.g. an invalid/revoked JWT, bad client secret) from
 * a transient one (5xx / network) and avoid permanently sidelining a connection
 * on a blip. `status` is undefined for a network-level failure.
 */
export class RingCentralOAuthError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'RingCentralOAuthError'
  }

  /** True for client errors (4xx) — the credential is genuinely bad. */
  get isPermanent(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500
  }
}

// ---------------------------------------------------------------------------
// JWT-bearer token exchange
// ---------------------------------------------------------------------------

/** The per-tenant credentials a connection authenticates with. */
export interface JwtCredentials {
  clientId: string
  clientSecret: string
  jwt: string
  /** Optional RingCentral environment override (sandbox vs production). */
  apiBase?: string
}

/** JWT-bearer returns only an access token — no refresh token. */
export interface JwtTokenResponse {
  access_token: string
  expires_in: number
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
}

/**
 * Exchanges a tenant's JWT (+ their app's client id/secret) for a short-lived
 * access token via RingCentral's `jwt-bearer` grant. Throws RingCentralOAuthError
 * with the HTTP status on failure (a 400 here means the credentials are bad).
 */
export async function exchangeJwtForToken(
  creds: JwtCredentials,
  apiBase: string,
): Promise<JwtTokenResponse> {
  const form = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: creds.jwt })
  const res = await fetch(new URL('/restapi/oauth/token', apiBase), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(creds.clientId, creds.clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new RingCentralOAuthError(
      `RingCentral token endpoint returned ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    )
  }
  return (await res.json()) as JwtTokenResponse
}

// ---------------------------------------------------------------------------
// Account / extension identity
// ---------------------------------------------------------------------------

export interface RcExtensionInfo {
  rcAccountId: string
  rcExtensionId: string
}

/**
 * Reads the authenticated account + extension ids via the extension-info
 * endpoint, used to key the RingCentralConnection at connect time.
 */
export async function fetchExtensionInfo(
  apiBase: string,
  accessToken: string,
): Promise<RcExtensionInfo> {
  const res = await fetch(new URL('/restapi/v1.0/account/~/extension/~', apiBase), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    // Carry the status so the connect handler can tell a permanent failure (e.g.
    // a 403 from a missing ReadAccounts scope) from a transient one.
    const text = await res.text().catch(() => '')
    throw new RingCentralOAuthError(
      `RingCentral extension-info returned ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    )
  }
  const body = (await res.json()) as { id?: number | string; account?: { id?: number | string } }
  if (body.id == null || body.account?.id == null) {
    throw new Error('RingCentral extension-info missing id/account.id')
  }
  return {
    rcExtensionId: String(body.id),
    rcAccountId: String(body.account.id),
  }
}
