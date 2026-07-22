// ---------------------------------------------------------------------------
// Outbound OAuth2 client-credentials token minting + cache.
//
// The generic, integration-agnostic counterpart to the RingCentral token cache
// (services/ringcentral/client.ts): the same in-memory-Map + 60s-skew +
// invalidate-on-401 machinery, but minting via the OAuth2 **client_credentials**
// grant (`Authorization: Basic base64(id:secret)` + `grant_type=client_credentials`)
// for an integration's configured token endpoint, keyed by (tenant, integration).
//
// Two partner-shaped wrinkles this handles that the RingCentral path does not:
//   1. The token response may be **XML** (Sirva ADE returns an `<Access>` doc,
//      not JSON) — parseAccessToken accepts either.
//   2. The token is short-lived (ADE: 10 min, no refresh), so the caller re-mints
//      on a 401 via invalidateOutboundToken + a single retry (the 0007 pattern).
//
// Credentials never touch workflow code: the caller reads CLIENT_ID/CLIENT_SECRET
// from the tenant's encrypted WorkflowSecretConfig store and passes them here.
//
// ── Two tiers (sdk-feedback 0027) ──────────────────────────────────────────
// L1 is the in-process Map below. It is correct but per-container, and the API
// Lambda scales horizontally — two sequential call_external requests can land on
// two containers, each with an empty Map, so the partner's token endpoint gets
// hit twice for a token that is still valid. That is precisely what 0027 observed
// (three calls → three mints, expires_in=600).
//
// L2 (outbound_oauth_tokens, KMS-encrypted) is the tier those containers share.
// Lookup order is L1 → L2 → mint, writing through to both. The warm path still
// costs nothing; only a cold/scaled-out container pays a DB read + KMS decrypt
// (~15-50ms) in place of a token round-trip (~100-500ms).
//
// L2 is opt-in via OUTBOUND_OAUTH_SHARED_CACHE_ENABLED (default off) — see
// lib/outbound-oauth-feature.ts for why it ships dark.
//
// Every outcome emits a structured log line (`outbound oauth token`) carrying the
// container id, because before this there was NO production signal distinguishing
// a mint from a cache hit on this path.
// ---------------------------------------------------------------------------

import { logger } from '../../lib/logger'
import { randomUUID } from 'node:crypto'
import type { OutboundOAuthTokenRepository } from '../../repositories/outbound-oauth-token.repository'

/** Re-mint this far ahead of expiry so a token can't die mid-flight. */
const EXPIRY_SKEW_MS = 60_000

/**
 * Stable for the life of this container, fresh on every cold start — so the log
 * line below shows directly whether sequential requests shared a container. This
 * is the field that distinguishes "the cache is broken" from "the cache worked but
 * the request landed somewhere else", which is the whole ambiguity in 0027.
 */
const INSTANCE_ID = randomUUID().slice(0, 8)

/** Where a token came from — the value reported as `outcome` in the log line. */
type TokenOutcome = 'l1_hit' | 'l2_hit' | 'mint'

/** A minted access token plus its computed expiry (epoch ms). */
interface CachedOutboundToken {
  accessToken: string
  tokenType: string
  expiresAt: number
}

// In-memory token cache, keyed by `${tenantId}:${integrationId}:${tokenUrl}` so a
// tenant's minted token is never reused across integrations or environments
// (test vs prod token endpoints differ). Lives for the warm Lambda container's
// lifetime; a cold start simply re-mints.
const tokenCache = new Map<string, CachedOutboundToken>()

export function __resetOutboundTokenCacheForTests(): void {
  tokenCache.clear()
}

/** The cache key for a (tenant, integration, token endpoint) triple. */
export function outboundTokenCacheKey(
  tenantId: string,
  integrationId: string,
  tokenUrl: string,
): string {
  return `${tenantId}:${integrationId}:${tokenUrl}`
}

/**
 * Drop a cached token so the next {@link acquireOutboundToken} re-mints. Called
 * after a partner returns 401 `invalid_token` on a call we authenticated with a
 * still-locally-unexpired token (the provider expired it early) — a TTL-only
 * cache would otherwise keep re-presenting the dead token until a cold start.
 */
export function invalidateOutboundToken(cacheKey: string): void {
  tokenCache.delete(cacheKey)
}

/**
 * Invalidate BOTH tiers after a partner 401.
 *
 * Clearing only L1 would be a correctness bug once the shared tier is on: this
 * container re-mints, but every other container keeps serving the token the
 * partner just rejected out of L2 until its nominal expiry. The whole point of a
 * 401 is that the token is dead earlier than it claims.
 *
 * Shared-tier failure is swallowed — the local drop already guarantees THIS
 * request re-mints, and throwing here would turn a recoverable 401 into a 500.
 */
export async function invalidateOutboundTokenEverywhere(
  cacheKey: string,
  shared?: SharedTokenTier,
): Promise<void> {
  tokenCache.delete(cacheKey)
  if (!shared) return
  try {
    await shared.repo.deleteKey(shared.key)
  } catch (err) {
    logger.warn('outbound oauth shared cache invalidation failed', {
      instanceId: INSTANCE_ID,
      integrationId: shared.key.integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Credentials + endpoint needed to mint a client-credentials token. */
export interface OutboundOAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
}

/** Thrown when the token endpoint rejects the client credentials. */
export class OutboundOAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'OutboundOAuthError'
  }
}

/**
 * Parse an access-token response body that may be **JSON** or the **XML**
 * `<Access>` document Sirva ADE returns:
 *
 *   <Access xmlns="...">
 *     <access_token>…</access_token>
 *     <expires_in>600</expires_in>
 *     <token_type>Bearer</token_type>
 *   </Access>
 *
 * Returns null when neither shape yields an `access_token` (caller raises).
 */
export function parseAccessToken(
  body: string,
  contentType: string | null,
): { accessToken: string; expiresIn: number; tokenType: string } | null {
  const looksJson = (contentType ?? '').includes('json') || body.trimStart().startsWith('{')
  if (looksJson) {
    try {
      const j = JSON.parse(body) as Record<string, unknown>
      const accessToken = typeof j.access_token === 'string' ? j.access_token : null
      if (accessToken) {
        return {
          accessToken,
          expiresIn: typeof j.expires_in === 'number' ? j.expires_in : Number(j.expires_in) || 0,
          tokenType: typeof j.token_type === 'string' ? j.token_type : 'Bearer',
        }
      }
    } catch {
      // fall through to XML parsing
    }
  }
  // Flat-XML extraction — the `<Access>` doc has no nesting, so a tag-scoped
  // regex is sufficient and avoids adding an XML dependency (cf. lib/cron.ts,
  // deliberately dependency-free).
  const tag = (name: string): string | null => {
    const m = body.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i'))
    const captured = m?.[1]
    return captured !== undefined ? captured.trim() : null
  }
  const accessToken = tag('access_token')
  if (!accessToken) return null
  const expiresRaw = tag('expires_in')
  return {
    accessToken,
    expiresIn: expiresRaw ? Number(expiresRaw) || 0 : 0,
    tokenType: tag('token_type') ?? 'Bearer',
  }
}

/**
 * The shared (L2) tier, injected by the caller. Absent ⇒ L1-only, which is both
 * the flag-off production path and the default in unit tests.
 */
export interface SharedTokenTier {
  /** Namespaced identity of the cached token in the shared store. */
  key: { tenantId: string; integrationId: string; tokenUrl: string }
  repo: OutboundOAuthTokenRepository
  /** KMS wrappers, injected so this module stays free of AWS imports. */
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<string>
}

/**
 * Return a valid bearer access token for the given (cacheKey, config), minting a
 * fresh one via the client-credentials grant only when no tier holds a token that
 * outlives the 60s skew. `fetchImpl`/`now` are injectable for tests.
 *
 * Lookup order is L1 (this container's Map) → L2 (`shared`, when supplied) →
 * mint, writing a freshly minted token through to both tiers.
 *
 * A failure in the shared tier is **never** fatal: L2 is a cache, so a DB or KMS
 * error degrades to a mint (logged) rather than failing the caller's outbound
 * call. Losing the optimization beats losing the request.
 *
 * @throws {OutboundOAuthError} if the token endpoint rejects the credentials or
 *   returns a body with no parseable access token.
 */
export async function acquireOutboundToken(
  cacheKey: string,
  config: OutboundOAuthConfig,
  opts: { now?: number; fetchImpl?: typeof fetch; shared?: SharedTokenTier } = {},
): Promise<string> {
  const now = opts.now ?? Date.now()
  const doFetch = opts.fetchImpl ?? fetch
  const shared = opts.shared

  const report = (outcome: TokenOutcome, extra: Record<string, unknown> = {}): void => {
    logger.info('outbound oauth token', {
      outcome,
      instanceId: INSTANCE_ID,
      sharedTier: shared ? 'on' : 'off',
      ...(shared ? { integrationId: shared.key.integrationId, tenantId: shared.key.tenantId } : {}),
      ...extra,
    })
  }

  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now + EXPIRY_SKEW_MS) {
    report('l1_hit', { expiresInMs: cached.expiresAt - now })
    return cached.accessToken
  }

  if (shared) {
    try {
      const row = await shared.repo.findFresh(shared.key, new Date(now + EXPIRY_SKEW_MS))
      if (row) {
        const accessToken = await shared.decrypt(row.tokenCiphertext)
        // Promote into L1 so the rest of this container's requests skip the DB.
        tokenCache.set(cacheKey, {
          accessToken,
          tokenType: 'Bearer',
          expiresAt: row.expiresAt.getTime(),
        })
        report('l2_hit', { expiresInMs: row.expiresAt.getTime() - now })
        return accessToken
      }
    } catch (err) {
      // Degrade to a mint — see the doc comment above.
      logger.warn('outbound oauth shared cache read failed', {
        instanceId: INSTANCE_ID,
        integrationId: shared.key.integrationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  let res: Response
  try {
    res = await doFetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json, application/xml;q=0.9, */*;q=0.8',
      },
      body: 'grant_type=client_credentials',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'token request failed'
    throw new OutboundOAuthError(`token endpoint unreachable: ${message}`, 502)
  }

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new OutboundOAuthError(
      `token endpoint returned ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    )
  }
  const parsed = parseAccessToken(text, res.headers.get('content-type'))
  if (!parsed) {
    throw new OutboundOAuthError('token endpoint response had no access_token', 502)
  }
  // ADE tokens carry expires_in seconds; if absent, treat as a short 5-min
  // token so we re-mint conservatively rather than caching indefinitely.
  const expiresAt = now + (parsed.expiresIn > 0 ? parsed.expiresIn : 300) * 1000
  tokenCache.set(cacheKey, {
    accessToken: parsed.accessToken,
    tokenType: parsed.tokenType,
    expiresAt,
  })

  if (shared) {
    try {
      const ciphertext = await shared.encrypt(parsed.accessToken)
      await shared.repo.upsert(shared.key, ciphertext, new Date(expiresAt))
    } catch (err) {
      // The token we just minted is still good and already in L1 — a failed
      // write-through only costs other containers a mint of their own.
      logger.warn('outbound oauth shared cache write failed', {
        instanceId: INSTANCE_ID,
        integrationId: shared.key.integrationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  report('mint', { expiresInSec: parsed.expiresIn })
  return parsed.accessToken
}
