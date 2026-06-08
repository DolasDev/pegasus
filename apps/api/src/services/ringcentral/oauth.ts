// ---------------------------------------------------------------------------
// RingCentral 3-legged OAuth (connect flow).
//
// One platform-level RingCentral app; each tenant authorises it. The `start`
// endpoint builds the authorize URL with a signed `state` carrying the tenant
// identity (the callback is pre-tenant, so state is how we re-bind the tenant)
// plus a nonce for CSRF. The `callback` exchanges the code for tokens and reads
// the account/extension identity needed to record the connection.
//
// Access tokens are never persisted; only the rotating refresh token is stored
// (in Secrets Manager — see lib/ringcentral-secrets.ts).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_API_BASE = 'https://platform.ringcentral.com'

export interface RingCentralOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  apiBase: string
  stateSecret: string
}

/**
 * Reads RingCentral OAuth config from the environment. Returns null when the
 * integration is not fully configured (flag off or a missing var), so callers
 * fail closed (503) rather than half-initialising.
 */
export function readOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): RingCentralOAuthConfig | null {
  if (env['RINGCENTRAL_ENABLED'] !== 'true') return null
  const clientId = env['RINGCENTRAL_CLIENT_ID']
  const clientSecret = env['RINGCENTRAL_CLIENT_SECRET']
  const redirectUri = env['RINGCENTRAL_OAUTH_REDIRECT_URI']
  const stateSecret = env['RINGCENTRAL_OAUTH_STATE_SECRET']
  if (!clientId || !clientSecret || !redirectUri || !stateSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri,
    stateSecret,
    apiBase: env['RINGCENTRAL_API_BASE'] ?? DEFAULT_API_BASE,
  }
}

// ---------------------------------------------------------------------------
// State signing (HMAC-SHA256, URL-safe)
// ---------------------------------------------------------------------------

export interface OAuthState {
  tenantId: string
  /** The SMS-enabled number being connected (E.164), supplied at start. */
  ownerNumber: string
  /** CSRF nonce. */
  nonce: string
  /** Issued-at epoch ms — used to reject replays of a stale authorize URL. */
  iat: number
}

/** Max age of a signed state before the callback rejects it (10 minutes). */
export const STATE_MAX_AGE_MS = 10 * 60 * 1000

const b64url = (buf: Buffer): string => buf.toString('base64url')

/** Signs the state payload as `<base64url(json)>.<base64url(hmac)>`. */
export function signState(state: OAuthState, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(state), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

/**
 * Verifies and decodes a signed state token, or returns null if tampered,
 * malformed, or older than `maxAgeMs` (replay protection for a leaked URL).
 */
export function verifyState(
  token: string,
  secret: string,
  maxAgeMs: number = STATE_MAX_AGE_MS,
  now: number = Date.now(),
): OAuthState | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = b64url(createHmac('sha256', secret).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState
    if (typeof parsed.tenantId !== 'string' || typeof parsed.ownerNumber !== 'string') return null
    if (typeof parsed.iat !== 'number') return null
    // Reject stale (or implausibly future-dated) states.
    if (now - parsed.iat > maxAgeMs || parsed.iat - now > 60_000) return null
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Authorize URL
// ---------------------------------------------------------------------------

/** Builds the RingCentral authorize URL the admin's browser is redirected to. */
export function buildAuthorizeUrl(config: RingCentralOAuthConfig, state: string): string {
  const url = new URL('/restapi/oauth/authorize', config.apiBase)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface RcTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  refresh_token_expires_in: number
  scope: string
  owner_id: string
}

function basicAuth(config: RingCentralOAuthConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
}

async function postToken(
  config: RingCentralOAuthConfig,
  form: URLSearchParams,
): Promise<RcTokenResponse> {
  const res = await fetch(new URL('/restapi/oauth/token', config.apiBase), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RingCentral token endpoint returned ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as RcTokenResponse
}

/** Exchanges an authorization code for access + refresh tokens. */
export async function exchangeCodeForToken(
  config: RingCentralOAuthConfig,
  code: string,
): Promise<RcTokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  })
  return postToken(config, form)
}

/** Refreshes an access token using the rotating refresh token. */
export async function refreshAccessToken(
  config: RingCentralOAuthConfig,
  refreshToken: string,
): Promise<RcTokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  return postToken(config, form)
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
 * endpoint, used to key the RingCentralConnection. (The fuller RC client lands
 * in Unit 6; the connect flow needs only these identifiers.)
 */
export async function fetchExtensionInfo(
  config: RingCentralOAuthConfig,
  accessToken: string,
): Promise<RcExtensionInfo> {
  const res = await fetch(new URL('/restapi/v1.0/account/~/extension/~', config.apiBase), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RingCentral extension-info returned ${res.status}: ${text.slice(0, 200)}`)
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
