// ---------------------------------------------------------------------------
// RingCentral REST client.
//
// Wraps authenticated calls to the RingCentral platform API:
//   - acquireAccessToken: refreshes (and rotates) a connection's OAuth token,
//     caching the short-lived access token in-memory per warm Lambda container
//     so a sync run makes one rotation, not one per API call.
//   - makeClient: a thin GET/POST wrapper that honours rate limits (429 →
//     RateLimitError with the Retry-After delay) and surfaces other failures.
//
// Token rotation reuses the same Secrets-Manager + repository path as the
// token-refresh cron, so the stored refresh token is always the latest.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { type RingCentralOAuthConfig, refreshAccessToken, RingCentralOAuthError } from './oauth'
import { getRefreshToken, storeRefreshToken } from '../../lib/ringcentral-secrets'
import { markTokenRefreshed } from '../../repositories/messaging.repository'

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
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

/** A connection's fields needed to acquire a token. */
export interface TokenConnection {
  id: string
  tokenSecretArn: string | null
}

/**
 * Returns a valid access token for the connection, refreshing (and rotating the
 * stored refresh token) only when the cached access token is missing or within
 * 60s of expiry.
 *
 * @throws {Error} if the connection has no stored refresh-token secret.
 */
export async function acquireAccessToken(
  config: RingCentralOAuthConfig,
  db: PrismaClient,
  connection: TokenConnection,
  now: number = Date.now(),
): Promise<string> {
  const cached = tokenCache.get(connection.id)
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken
  }
  if (!connection.tokenSecretArn) {
    throw new Error(`Connection ${connection.id} has no stored refresh token`)
  }
  const refreshToken = await getRefreshToken(connection.tokenSecretArn)
  const tokens = await refreshAccessToken(config, refreshToken)
  const arn = await storeRefreshToken(connection.id, tokens.refresh_token)
  await markTokenRefreshed(db, connection.id, new Date(now), arn)
  tokenCache.set(connection.id, {
    accessToken: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1000,
  })
  return tokens.access_token
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
