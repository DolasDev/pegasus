// ---------------------------------------------------------------------------
// pegII service-user authentication — turns a tenant's stored credential into
// a bearer token for the pegII team's on-prem API.
//
// The pegII API (movemanager `dev`) authenticates with JWTs minted by
// `POST /api/v1/pegii/auth/login` for a hub user. The platform holds one
// dedicated service user per tenant; its `{username, password}` live ONLY in a
// Secrets Manager secret whose ARN is stored on the tenant
// (`Tenant.pegiiApiKeyRef`). This module reads that secret, logs in over the
// tunnel, and caches the token per tenant+site until shortly before it expires.
// The pegII API has no refresh endpoint, so renewal is simply another login;
// a 401 from any route invalidates the cache (see pegii-api-client.ts).
//
// Credentials and tokens are never logged or returned to callers.
// ---------------------------------------------------------------------------

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { tunnelFetch, TunnelError } from './tunnel-client'
import { PegiiApiError } from './pegii-api-error'

/** The service-user credential blob stored in Secrets Manager. */
export interface PegiiServiceCredentials {
  username: string
  password: string
}

/** Re-login this long before the token's `exp`, to absorb clock skew and in-flight calls. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000
/** How long a fetched secret is reused before Secrets Manager is read again. */
const SECRET_TTL_MS = 5 * 60 * 1000

const SECRET_ARN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+/

/** True when a tenant's pegII credential reference is a Secrets Manager ARN. */
export function isPegiiCredentialSecretRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && SECRET_ARN.test(ref)
}

type CachedToken = { token: string; renewAt: number }
const tokenCache = new Map<string, CachedToken>()
const secretCache = new Map<string, { creds: PegiiServiceCredentials; fetchedAt: number }>()

/** Test seam: clear both caches. */
export function __resetPegiiAuthCachesForTests(): void {
  tokenCache.clear()
  secretCache.clear()
}

let _sm: SecretsManagerClient | null = null
async function readSecret(arn: string): Promise<PegiiServiceCredentials> {
  _sm ??= new SecretsManagerClient({})
  const out = await _sm.send(new GetSecretValueCommand({ SecretId: arn }))
  const parsed = JSON.parse(out.SecretString ?? '{}') as Partial<PegiiServiceCredentials>
  if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
    throw new PegiiApiError(
      'PEGII_API_AUTH_FAILED',
      'pegII credential secret must contain string "username" and "password" fields',
    )
  }
  return { username: parsed.username, password: parsed.password }
}

/** The `exp` claim of a JWT, in ms; null if the token is not a readable JWT. */
export function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown
    }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

export interface PegiiTokenProvider {
  /** A valid bearer token, logging in when none is cached (or it is near expiry). */
  getToken(): Promise<string>
  /** Drop the cached token, e.g. after the API rejected it with 401. */
  invalidate(): void
}

export interface PegiiTokenProviderOptions {
  tenantId: string
  baseUrl: string
  /** ARN of the Secrets Manager secret holding the service user's credentials. */
  secretArn: string
  timeoutMs?: number
  /** Test seams. */
  fetchSecret?: (arn: string) => Promise<PegiiServiceCredentials>
  now?: () => number
}

export function createPegiiTokenProvider(opts: PegiiTokenProviderOptions): PegiiTokenProvider {
  const now = opts.now ?? Date.now
  const fetchSecret = opts.fetchSecret ?? readSecret
  const cacheKey = `${opts.tenantId}|${opts.baseUrl}`

  async function credentials(): Promise<PegiiServiceCredentials> {
    const cached = secretCache.get(opts.secretArn)
    if (cached && now() - cached.fetchedAt < SECRET_TTL_MS) return cached.creds
    const creds = await fetchSecret(opts.secretArn)
    secretCache.set(opts.secretArn, { creds, fetchedAt: now() })
    return creds
  }

  async function login(): Promise<string> {
    const creds = await credentials()
    let res
    try {
      res = await tunnelFetch(`${opts.baseUrl}/api/v1/pegii/auth/login`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      })
    } catch (err) {
      if (err instanceof TunnelError) {
        throw new PegiiApiError('PEGII_API_TUNNEL_ERROR', `${err.code}: ${err.message}`)
      }
      throw err
    }

    let json: { data?: { token?: unknown }; code?: string } = {}
    try {
      json = (await res.json()) as typeof json
    } catch {
      // A 404 from a site without auth routes has no JSON body — handled below.
    }
    if (res.status === 401) {
      // Wrong credentials: drop the cached secret so a rotation is picked up next time.
      secretCache.delete(opts.secretArn)
      throw new PegiiApiError(
        'PEGII_API_AUTH_FAILED',
        'pegII rejected the service-user credentials',
        401,
      )
    }
    if (res.status === 404 || res.status === 503) {
      throw new PegiiApiError(
        'PEGII_API_AUTH_UNAVAILABLE',
        `pegII login is not available on this site (${res.status} ${json.code ?? ''}); the site needs Api:Jwt and a hub DB`.trim(),
        res.status,
      )
    }
    const token = json.data?.token
    if (!res.ok || typeof token !== 'string' || !token) {
      throw new PegiiApiError(
        'PEGII_API_BAD_ENVELOPE',
        `pegII login returned no token (status ${res.status})`,
        res.status,
      )
    }
    const exp = jwtExpiryMs(token)
    // Unknown expiry: reuse for a short, safe window rather than forever.
    const renewAt = exp !== null ? exp - EXPIRY_MARGIN_MS : now() + EXPIRY_MARGIN_MS
    tokenCache.set(cacheKey, { token, renewAt })
    return token
  }

  return {
    async getToken() {
      const cached = tokenCache.get(cacheKey)
      if (cached && now() < cached.renewAt) return cached.token
      return login()
    },
    invalidate() {
      tokenCache.delete(cacheKey)
    },
  }
}
