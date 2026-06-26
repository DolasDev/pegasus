// ---------------------------------------------------------------------------
// RingCentral REST client.
//
// Wraps authenticated calls to the RingCentral platform API:
//   - acquireAccessToken: mints a short-lived access token from a connection's
//     stored JWT credentials (RingCentral's jwt-bearer grant), caching it
//     in-memory per warm Lambda container so a sync run does one exchange, not
//     one per API call. The JWT is the durable credential — there is nothing to
//     rotate or write back.
//   - makeClient: a thin GET/POST wrapper that honours rate limits (429 →
//     RateLimitError with the Retry-After delay) and surfaces other failures.
// ---------------------------------------------------------------------------

import { DEFAULT_API_BASE, exchangeJwtForToken, RingCentralOAuthError } from './oauth'
import { getConnectionCredentials } from '../../lib/ringcentral-secrets'

/** Thrown on a 429 — carries how long to wait before retrying. */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`RingCentral rate-limited; retry after ${retryAfterMs}ms`)
    this.name = 'RateLimitError'
  }
}

// In-memory access-token cache, keyed by connection id. Lives for the warm
// container's lifetime; a cold start simply re-acquires. Exported reset for tests.
interface CachedToken {
  accessToken: string
  apiBase: string
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

/**
 * Drop the cached access token for a connection so the next
 * {@link acquireAccessToken} re-mints from the JWT. Callers use this to recover
 * from a token RingCentral invalidated *before* its local expiry (e.g. JWT
 * rotation across the SMS/sync/subscription callers that share the credential),
 * which a TTL-only cache would otherwise keep re-presenting until a cold start.
 */
export function invalidateToken(connectionId: string): void {
  tokenCache.delete(connectionId)
}

/** A connection's fields needed to acquire a token. */
export interface TokenConnection {
  id: string
  tokenSecretArn: string | null
}

/** A freshly-minted access token plus the RingCentral environment it's for. */
export interface AcquiredToken {
  accessToken: string
  apiBase: string
}

/**
 * Returns a valid access token (and the connection's RingCentral environment)
 * by exchanging the connection's stored JWT credentials via the jwt-bearer
 * grant, only when the cached token is missing or within 60s of expiry.
 *
 * @throws {Error} if the connection has no stored credential secret.
 * @throws {RingCentralOAuthError} if the JWT/credentials are rejected.
 */
export async function acquireAccessToken(
  connection: TokenConnection,
  now: number = Date.now(),
): Promise<AcquiredToken> {
  const cached = tokenCache.get(connection.id)
  if (cached && cached.expiresAt > now + 60_000) {
    return { accessToken: cached.accessToken, apiBase: cached.apiBase }
  }
  if (!connection.tokenSecretArn) {
    throw new Error(`Connection ${connection.id} has no stored credentials`)
  }
  const creds = await getConnectionCredentials(connection.tokenSecretArn)
  const apiBase = creds.apiBase ?? DEFAULT_API_BASE
  const tokens = await exchangeJwtForToken(creds, apiBase)
  tokenCache.set(connection.id, {
    accessToken: tokens.access_token,
    apiBase,
    expiresAt: now + tokens.expires_in * 1000,
  })
  return { accessToken: tokens.access_token, apiBase }
}

// ---------------------------------------------------------------------------
// REST wrapper
// ---------------------------------------------------------------------------

export interface RingCentralClient {
  get<T = unknown>(path: string, query?: Record<string, string>): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
  del(path: string): Promise<void>
}

/** Parses a Retry-After header (seconds, per RC) into ms; defaults to 60s. */
function retryAfterMs(res: Response): number {
  const header = res.headers.get('Retry-After') ?? res.headers.get('X-Rate-Limit-Window')
  const seconds = header ? Number(header) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 429) {
    throw new RateLimitError(retryAfterMs(res))
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new RingCentralOAuthError(
      `RingCentral API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    )
  }
  return (await res.json()) as T
}

/** Builds a client bound to a base URL + access token. */
export function makeClient(apiBase: string, accessToken: string): RingCentralClient {
  const auth = { Authorization: `Bearer ${accessToken}` }
  return {
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      const url = new URL(path, apiBase)
      if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
      return handle<T>(await fetch(url, { headers: auth }))
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const url = new URL(path, apiBase)
      return handle<T>(
        await fetch(url, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      const url = new URL(path, apiBase)
      return handle<T>(
        await fetch(url, {
          method: 'PUT',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    },
    async del(path: string): Promise<void> {
      const res = await fetch(new URL(path, apiBase), { method: 'DELETE', headers: auth })
      if (res.status === 429) throw new RateLimitError(retryAfterMs(res))
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new RingCentralOAuthError(
          `RingCentral API ${res.status}: ${text.slice(0, 200)}`,
          res.status,
        )
      }
      // DELETE returns 204 No Content — nothing to parse.
    },
  }
}
