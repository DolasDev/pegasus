// ---------------------------------------------------------------------------
// RingCentral REST client.
//
// Wraps authenticated calls to the RingCentral platform API:
//   - acquireAccessToken: returns an access token for a connection. Tokens are
//     minted from the connection's stored JWT (RingCentral's jwt-bearer grant)
//     and cached in two tiers: L1 is this container's memory; L2 is one shared
//     Postgres row per connection (shared-token-store.ts). Lookup is L1 → L2 →
//     a single-flight mint under a per-connection lock.
//   - withRingCentralToken: runs a call with a token; on a 401 it discards that
//     exact token (both tiers), re-acquires and retries once.
//   - makeClient: a thin REST wrapper that honors rate limits (429 →
//     RateLimitError with the Retry-After delay) and surfaces other failures.
//
// Why two tiers: every mint is a new RingCentral session, and RingCentral keeps
// only ~5 per user per app, revoking the oldest. The crons cold-start on almost
// every run, so an L1-only cache minted ~190 sessions/day for one connection
// and evicted the legacy desktop's token (401 OAU-213). Sharing one token cuts
// that to roughly one mint per token lifetime (~1h).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { DEFAULT_API_BASE, exchangeJwtForToken, RingCentralOAuthError } from './oauth'
import { getConnectionCredentials } from '../../lib/ringcentral-secrets'
import { createLogger } from '../../lib/logger'
import { db } from '../../db'
import {
  decryptRingCentralToken,
  encryptRingCentralToken,
  isRingCentralTokenCryptoConfigured,
} from '../../lib/ringcentral-token-crypto'
import { createRingCentralAccessTokenRepository } from '../../repositories/ringcentral-access-token.repository'
import {
  createSharedTokenStore,
  type SharedToken,
  type SharedTokenStore,
} from './shared-token-store'

const logger = createLogger('pegasus-ringcentral-token')

/** Fresh per cold start, so logs show whether calls shared a container. */
const INSTANCE_ID = randomUUID().slice(0, 8)

/**
 * Reuse a token only while it has more than this left. Generous on purpose:
 * re-minting a few minutes early costs nothing, and a token must not expire
 * mid-sync.
 */
export const REUSE_MARGIN_MS = 5 * 60_000

/** Thrown on a 429 — carries how long to wait before retrying. */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`RingCentral rate-limited; retry after ${retryAfterMs}ms`)
    this.name = 'RateLimitError'
  }
}

// L1: in-memory, keyed by connection id, for the warm container's lifetime.
const tokenCache = new Map<string, SharedToken>()

// L2: resolved lazily. `undefined` = not resolved yet; `null` = off (no KMS key
// configured, or RINGCENTRAL_SHARED_TOKEN_DISABLED=true).
let sharedStore: SharedTokenStore | null | undefined

/**
 * Whether the shared (L2) tier is on: the KMS key it encrypts with is
 * configured, and the RINGCENTRAL_SHARED_TOKEN_DISABLED kill switch is not set.
 */
export function isSharedTokenTierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['RINGCENTRAL_SHARED_TOKEN_DISABLED'] !== 'true' && isRingCentralTokenCryptoConfigured(env)
  )
}

function getSharedStore(): SharedTokenStore | null {
  if (sharedStore !== undefined) return sharedStore
  if (!isSharedTokenTierEnabled()) {
    sharedStore = null
  } else {
    sharedStore = createSharedTokenStore(createRingCentralAccessTokenRepository(db), {
      encrypt: encryptRingCentralToken,
      decrypt: decryptRingCentralToken,
    })
  }
  return sharedStore
}

/** Resets L1 and re-resolves L2 from the environment on next use. */
export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
  sharedStore = undefined
}

/** Injects an L2 store (or `null` for L1 only). */
export function __setSharedTokenStoreForTests(store: SharedTokenStore | null): void {
  sharedStore = store
}

type TokenOutcome = 'l1_hit' | 'l2_hit' | 'l2_hit_after_lock' | 'mint' | 'mint_unshared'

function report(connectionId: string, outcome: TokenOutcome, extra: Record<string, unknown> = {}) {
  logger.info('ringcentral token', { outcome, connectionId, instanceId: INSTANCE_ID, ...extra })
}

function warn(message: string, connectionId: string, err: unknown) {
  logger.warn(message, {
    connectionId,
    instanceId: INSTANCE_ID,
    error: err instanceof Error ? err.message : String(err),
  })
}

/**
 * Drop a token RingCentral rejected so the next {@link acquireAccessToken}
 * gets a different one. L1 is cleared outright. With `accessToken`, the L2 row
 * is deleted only if it still holds that exact token: when another container
 * has already replaced it, the newer token is kept, so a 401 doesn't trigger
 * another mint (another session). L2 failures are logged, not thrown.
 */
export async function invalidateToken(connectionId: string, accessToken?: string): Promise<void> {
  tokenCache.delete(connectionId)
  const store = accessToken ? getSharedStore() : null
  if (!store || !accessToken) return
  try {
    await store.discard(connectionId, accessToken)
  } catch (err) {
    warn('ringcentral shared token discard failed', connectionId, err)
  }
}

/** A connection's fields needed to acquire a token. */
export interface TokenConnection {
  id: string
  tokenSecretArn: string | null
}

/** An access token plus the RingCentral environment it's for. */
export interface AcquiredToken {
  accessToken: string
  apiBase: string
}

/** Exchanges the connection's JWT for a new token: one new RingCentral session. */
async function mintToken(connection: TokenConnection, now: number): Promise<SharedToken> {
  if (!connection.tokenSecretArn) {
    throw new Error(`Connection ${connection.id} has no stored credentials`)
  }
  const creds = await getConnectionCredentials(connection.tokenSecretArn)
  const apiBase = creds.apiBase ?? DEFAULT_API_BASE
  const tokens = await exchangeJwtForToken(creds, apiBase)
  return { accessToken: tokens.access_token, apiBase, expiresAt: now + tokens.expires_in * 1000 }
}

function remember(connectionId: string, token: SharedToken): AcquiredToken {
  tokenCache.set(connectionId, token)
  return { accessToken: token.accessToken, apiBase: token.apiBase }
}

/**
 * Returns a valid access token and the connection's RingCentral environment:
 * L1, then the shared L2 row, then a mint serialized per connection so that
 * containers going cold together mint once, not once each.
 *
 * L2 is a cache. If the database or KMS fails, this falls back to a plain mint
 * and logs a warning, so the caller's request still goes through.
 *
 * @throws {Error} if the connection has no stored credential secret.
 * @throws {RingCentralOAuthError} if the JWT/credentials are rejected.
 */
export async function acquireAccessToken(
  connection: TokenConnection,
  now: number = Date.now(),
): Promise<AcquiredToken> {
  const notExpiringBefore = now + REUSE_MARGIN_MS
  const cached = tokenCache.get(connection.id)
  if (cached && cached.expiresAt > notExpiringBefore) {
    report(connection.id, 'l1_hit')
    return { accessToken: cached.accessToken, apiBase: cached.apiBase }
  }

  const store = getSharedStore()
  if (!store) {
    const token = await mintToken(connection, now)
    report(connection.id, 'mint_unshared', { sharedTier: 'off' })
    return remember(connection.id, token)
  }

  try {
    const shared = await store.read(connection.id, notExpiringBefore)
    if (shared) {
      report(connection.id, 'l2_hit')
      return remember(connection.id, shared)
    }
  } catch (err) {
    warn('ringcentral shared token read failed', connection.id, err)
  }

  // A token minted inside the lock is a live RingCentral session. Keep a handle
  // on it so a failure after the mint (encrypt, upsert, commit) still uses it
  // instead of minting a second one.
  let minted: SharedToken | undefined
  try {
    const result = await store.mintOnce(connection.id, notExpiringBefore, async () => {
      minted = await mintToken(connection, now)
      return minted
    })
    report(connection.id, result.minted ? 'mint' : 'l2_hit_after_lock')
    return remember(connection.id, result.token)
  } catch (err) {
    if (minted) {
      warn('ringcentral shared token write failed; using the minted token', connection.id, err)
      report(connection.id, 'mint')
      return remember(connection.id, minted)
    }
    // The mint itself failed: bad credentials are the caller's problem.
    if (err instanceof RingCentralOAuthError) throw err
    // Lock/DB failure before minting: mint without the shared tier. (A missing
    // credential secret just throws again from here.)
    warn('ringcentral shared token lock failed; minting unshared', connection.id, err)
    const token = await mintToken(connection, now)
    report(connection.id, 'mint_unshared', { sharedTier: 'error' })
    return remember(connection.id, token)
  }
}

/**
 * Runs `call` with an authenticated client. If RingCentral answers 401 (it
 * revoked the token early, e.g. its per-user session cap evicted it), the
 * failed token is discarded from both tiers and the call is retried once with
 * a fresh one. A 401 means RingCentral rejected the request before acting on
 * it, so the retry cannot double-apply anything.
 *
 * Only a 401 from `call` triggers this. A failure acquiring the token (e.g.
 * the token endpoint rejecting the JWT) propagates at once. If the retry also
 * gets a 401, its fresh token is NOT discarded: a second rejection of a
 * brand-new token is not about the token, and discarding it would only cost
 * every later caller another mint.
 */
export async function withRingCentralToken<T>(
  connection: TokenConnection,
  call: (client: RingCentralClient, token: AcquiredToken) => Promise<T>,
): Promise<T> {
  const first = await acquireAccessToken(connection)
  try {
    return await call(makeClient(first.apiBase, first.accessToken), first)
  } catch (err) {
    if (!(err instanceof RingCentralOAuthError && err.status === 401)) throw err
    await invalidateToken(connection.id, first.accessToken)
  }
  const second = await acquireAccessToken(connection)
  return call(makeClient(second.apiBase, second.accessToken), second)
}

/**
 * Adopt a token minted outside {@link acquireAccessToken} (the connect
 * handler's validation exchange) as the connection's shared token. That
 * replaces any token minted from the connection's previous credentials, which
 * would otherwise be served for up to an hour after a reconnect, and saves a
 * session by not minting again. A shared-tier failure is logged, not thrown.
 */
export async function adoptMintedToken(connectionId: string, token: SharedToken): Promise<void> {
  tokenCache.set(connectionId, token)
  const store = getSharedStore()
  if (!store) return
  try {
    await store.put(connectionId, token)
    report(connectionId, 'mint', { adopted: true })
  } catch (err) {
    warn('ringcentral shared token adopt failed', connectionId, err)
  }
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
      rcErrorCode(text),
      rcParameterName(text),
    )
  }
  return (await res.json()) as T
}

/**
 * The request parameter RingCentral rejected — top-level or the first entry of
 * `errors[]` (an `InvalidParameter`/CMN-101 body). Undefined otherwise.
 */
export function rcParameterName(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as {
      parameterName?: unknown
      errors?: Array<{ parameterName?: unknown }>
    }
    const name = body.parameterName ?? body.errors?.[0]?.parameterName
    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * RingCentral's machine-readable `errorCode` from an error body — top-level or
 * the first entry of `errors[]`. Undefined when the body is not RC-shaped JSON.
 */
export function rcErrorCode(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as {
      errorCode?: unknown
      errors?: Array<{ errorCode?: unknown }>
    }
    const code = body.errorCode ?? body.errors?.[0]?.errorCode
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
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
