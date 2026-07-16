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
// ---------------------------------------------------------------------------

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
 * Return a valid bearer access token for the given (cacheKey, config), minting a
 * fresh one via the client-credentials grant only when the cache is empty or the
 * cached token is within 60s of expiry. `fetchImpl`/`now` are injectable for tests.
 *
 * @throws {OutboundOAuthError} if the token endpoint rejects the credentials or
 *   returns a body with no parseable access token.
 */
export async function acquireOutboundToken(
  cacheKey: string,
  config: OutboundOAuthConfig,
  opts: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const now = opts.now ?? Date.now()
  const doFetch = opts.fetchImpl ?? fetch
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken
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
  tokenCache.set(cacheKey, {
    accessToken: parsed.accessToken,
    tokenType: parsed.tokenType,
    // ADE tokens carry expires_in seconds; if absent, treat as a short 5-min
    // token so we re-mint conservatively rather than caching indefinitely.
    expiresAt: now + (parsed.expiresIn > 0 ? parsed.expiresIn : 300) * 1000,
  })
  return parsed.accessToken
}
