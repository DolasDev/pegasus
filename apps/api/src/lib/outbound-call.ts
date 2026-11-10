// ---------------------------------------------------------------------------
// The authenticated outbound call — extracted from handlers/integration-call.ts
// so more than one endpoint can make one.
//
// WHY THIS EXISTS. `call-external` grew ~290 lines of handler body that mixed
// config resolution, the SSRF guard, four auth modes, the secret-header overlay
// and the timeout/retry/re-mint loop — and returned `c.json(...)` inline at
// every failure. Those inline responses are precisely what made it unreusable:
// a second consumer (the declarative `fetch` endpoint) needs the same transport
// with a DIFFERENT response shape. So the core returns a TYPED RESULT and each
// handler maps it to its own HTTP, via `outboundFailureToHttp` for the shared
// error contract.
//
// DELIBERATELY NOT IN HERE:
//   - blob handling (`$blob` request refs, `responseToBlob`) — call-external
//     only; a declarative fetch has no blob inputs and its records land in a
//     projection, not S3.
//   - the unknown-integration 404 — each handler resolves the definition for
//     its own reasons (the fetch endpoint already holds it, for `capabilities`).
//   - paging — call-external has no paging and must not gain a dormant code
//     path. One call per invocation; the fetch handler owns its page loop and
//     sums `attempts`.
//
// This extraction is BEHAVIOR-PRESERVING for call-external: every status code
// and `code` string it used to return is reproduced by `outboundFailureToHttp`,
// and the existing 47 call-external tests pass unchanged. A test that needed
// editing would mean the refactor changed behavior, not that the test was stale.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { logger } from './logger'
import { decryptSecretValue, encryptSecretValue } from './secret-value-crypto'
import { isOutboundOAuthSharedCacheEnabled } from './outbound-oauth-feature'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { createOutboundOAuthTokenRepository } from '../repositories/outbound-oauth-token.repository'
import {
  acquireOutboundToken,
  invalidateOutboundTokenEverywhere,
  outboundTokenCacheKey,
  OutboundOAuthError,
  type SharedTokenTier,
} from '../services/outbound-oauth'
import {
  validateHeaderMaps,
  resolveOutboundHeaders,
  MissingHeaderSecretError,
} from './outbound-headers'
import {
  isRetryableStatus,
  isIdempotent,
  retryDelayMs,
  clampMaxRetries,
  clampTimeoutMs,
} from './outbound-retry'

/** Default header name for `AUTH_MODE=apikey` — the Azure APIM convention. */
export const DEFAULT_API_KEY_HEADER = 'Ocp-Apim-Subscription-Key'

/** What to call and how, with the body already fully resolved by the caller. */
export interface OutboundCallSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean> | undefined
  /** Already-resolved JSON body (blob refs substituted by the caller, if any). */
  body?: unknown
  /**
   * Whether this request may be re-sent after a 429/503. A read is safe to
   * retry; a mutation is not, because a duplicate could double-write at the
   * partner. Pass it EXPLICITLY — a declarative fetch is always a read, even
   * when the partner exposes it as POST, so it must not be inferred from the
   * method alone.
   */
  mutating?: boolean | undefined
  headers?: Record<string, string> | undefined
  secretHeaders?: Record<string, string> | undefined
  group: string
  baseUrlConfig: string
  authModeConfig: string
  tokenUrlConfig: string
  clientIdSecret: string
  clientSecretSecret: string
  bearerSecret: string
  apiKeyHeaderConfig: string
  timeoutConfig: string
  maxRetriesConfig: string
}

export interface OutboundCallDeps {
  /** Request-scoped client — used for the tenant's secret/config store. */
  db: PrismaClient
  tenantId: string
  integrationId: string
}

/**
 * Why a call could not be made, or could not complete. One variant per
 * (status, code) pair call-external already returned, so the mapping below is
 * exhaustive and the contract is unchanged.
 */
export type OutboundFailure =
  /** 400 — a reserved/malformed caller header, a rejected URL, a bad AUTH_MODE. */
  | { kind: 'invalidRequest'; message: string }
  /** 404 — a required config or secret is not set for this tenant+group. */
  | { kind: 'notConfigured'; message: string }
  /** 502 — the token could not be minted, or the call could not be completed. */
  | { kind: 'upstreamError'; message: string }
  /** 504 — the partner accepted the connection and never answered. */
  | { kind: 'upstreamTimeout'; message: string }

export type OutboundCallResult =
  | { ok: true; response: Response; attempts: number; url: string }
  | { ok: false; failure: OutboundFailure }

/** The shared error contract: one failure variant → one (status, code, error). */
export function outboundFailureToHttp(failure: OutboundFailure): {
  status: 400 | 404 | 502 | 504
  body: { error: string; code: string }
} {
  switch (failure.kind) {
    case 'invalidRequest':
      return { status: 400, body: { error: failure.message, code: 'VALIDATION_ERROR' } }
    case 'notConfigured':
      return { status: 404, body: { error: failure.message, code: 'NOT_FOUND' } }
    case 'upstreamError':
      return { status: 502, body: { error: failure.message, code: 'UPSTREAM_ERROR' } }
    case 'upstreamTimeout':
      return { status: 504, body: { error: failure.message, code: 'UPSTREAM_TIMEOUT' } }
  }
}

/** Join a base URL and a path without dropping the base's own path segment. */
export function resolveOutboundUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean>,
): string {
  const joined = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  const url = new URL(joined)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

const invalid = (message: string): OutboundCallResult => ({
  ok: false,
  failure: { kind: 'invalidRequest', message },
})
const unconfigured = (message: string): OutboundCallResult => ({
  ok: false,
  failure: { kind: 'notConfigured', message },
})

/**
 * Resolve credentials and perform ONE authenticated outbound request, with the
 * timeout, 429/503 retry policy and single OAuth re-mint-on-401 that
 * call-external has always had.
 *
 * Returns the raw `Response` rather than a parsed body: the fetch endpoint has
 * to `decode` before it can walk `recordsPath`, and call-external may land the
 * bytes in a blob. Parsing here would force both to un-parse.
 *
 * `assertDeliverableUrl` is injected rather than imported to keep this module
 * free of a handler dependency (it lives in handlers/integration-delivery).
 */
export async function performOutboundCall(
  deps: OutboundCallDeps,
  spec: OutboundCallSpec,
  assertDeliverableUrl: (url: string) => string | null,
): Promise<OutboundCallResult> {
  const { db, tenantId, integrationId } = deps
  const repo = createWorkflowSecretConfigRepository(db)

  // Reject bad custom headers BEFORE any config/secret read — a reserved name
  // or a CRLF-bearing value is a client error, not a lookup failure.
  const headerError = validateHeaderMaps(spec)
  if (headerError) return invalid(headerError)

  // ── resolve config ────────────────────────────────────────────────────────
  const baseUrlRow = await repo.findByKey('CONFIG', spec.group, spec.baseUrlConfig)
  if (!baseUrlRow || baseUrlRow.value == null) {
    return unconfigured(`Config '${spec.baseUrlConfig}' (base URL) is not set`)
  }
  const authModeRow = await repo.findByKey('CONFIG', spec.group, spec.authModeConfig)
  const authMode = (authModeRow?.value ?? 'oauth2_client_credentials').trim()

  const url = resolveOutboundUrl(baseUrlRow.value, spec.path, spec.query)
  const urlError = assertDeliverableUrl(url)
  if (urlError) return invalid(urlError)

  // ── resolve auth ──────────────────────────────────────────────────────────
  // For OAuth we keep a re-mint closure so a 401 can invalidate + retry once.
  let cacheKey: string | null = null
  let remint: (() => Promise<string>) | null = null
  let sharedTier: SharedTokenTier | undefined
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (authMode === 'oauth2_client_credentials') {
    const tokenUrlRow = await repo.findByKey('CONFIG', spec.group, spec.tokenUrlConfig)
    if (!tokenUrlRow || tokenUrlRow.value == null) {
      return unconfigured(`Config '${spec.tokenUrlConfig}' (token URL) is not set`)
    }
    const idRow = await repo.findByKey('SECRET', spec.group, spec.clientIdSecret)
    const secretRow = await repo.findByKey('SECRET', spec.group, spec.clientSecretSecret)
    if (!idRow?.valueCiphertext || !secretRow?.valueCiphertext) {
      return unconfigured(
        `Secrets '${spec.clientIdSecret}'/'${spec.clientSecretSecret}' are not set`,
      )
    }
    const clientId = await decryptSecretValue(idRow.valueCiphertext, tenantId)
    const clientSecret = await decryptSecretValue(secretRow.valueCiphertext, tenantId)
    cacheKey = outboundTokenCacheKey(tenantId, integrationId, tokenUrlRow.value)
    const cfg = { tokenUrl: tokenUrlRow.value, clientId, clientSecret }
    // The shared (L2) tier is opt-in — flag off, this is byte-for-byte the
    // previous in-memory-only behavior. Tokens are KMS-encrypted with the same
    // per-tenant encryption context as the tenant's workflow secrets.
    if (isOutboundOAuthSharedCacheEnabled()) {
      sharedTier = {
        key: { tenantId, integrationId, tokenUrl: tokenUrlRow.value },
        repo: createOutboundOAuthTokenRepository(db),
        encrypt: (plaintext) => encryptSecretValue(plaintext, tenantId),
        decrypt: (ciphertext) => decryptSecretValue(ciphertext, tenantId),
      }
    }
    remint = () =>
      acquireOutboundToken(cacheKey!, cfg, { ...(sharedTier ? { shared: sharedTier } : {}) })
    try {
      headers.Authorization = `Bearer ${await remint()}`
    } catch (err) {
      if (err instanceof OutboundOAuthError) {
        return { ok: false, failure: { kind: 'upstreamError', message: err.message } }
      }
      throw err
    }
  } else if (authMode === 'bearer') {
    const keyRow = await repo.findByKey('SECRET', spec.group, spec.bearerSecret)
    if (!keyRow?.valueCiphertext) {
      return unconfigured(`Secret '${spec.bearerSecret}' (bearer) is not set`)
    }
    headers.Authorization = `Bearer ${await decryptSecretValue(keyRow.valueCiphertext, tenantId)}`
  } else if (authMode === 'apikey') {
    // Azure APIM and friends: the credential is a named header, not a bearer.
    // The header NAME is config (non-secret); only the value is a secret.
    const keyRow = await repo.findByKey('SECRET', spec.group, spec.bearerSecret)
    if (!keyRow?.valueCiphertext) {
      return unconfigured(`Secret '${spec.bearerSecret}' (api key) is not set`)
    }
    const nameRow = await repo.findByKey('CONFIG', spec.group, spec.apiKeyHeaderConfig)
    const headerName = (nameRow?.value ?? DEFAULT_API_KEY_HEADER).trim()
    // The name comes from tenant config, so it gets the same syntax + reserved
    // check as a caller-supplied header — otherwise `AUTH_MODE=apikey` with
    // `API_KEY_HEADER=Authorization` would quietly reintroduce the override
    // the reserved list exists to prevent.
    const nameError = validateHeaderMaps({ headers: { [headerName]: 'x' } })
    if (nameError) return invalid(`Config '${spec.apiKeyHeaderConfig}': ${nameError}`)
    headers[headerName] = await decryptSecretValue(keyRow.valueCiphertext, tenantId)
  } else if (authMode !== 'none') {
    return invalid(`Unsupported AUTH_MODE '${authMode}'`)
  }

  // ── overlay the caller's custom headers ───────────────────────────────────
  let finalHeaders: Record<string, string>
  try {
    finalHeaders = await resolveOutboundHeaders(headers, spec, async (secretKey) => {
      const row = await repo.findByKey('SECRET', spec.group, secretKey)
      if (!row?.valueCiphertext) return null
      return decryptSecretValue(row.valueCiphertext, tenantId)
    })
  } catch (err) {
    if (err instanceof MissingHeaderSecretError) {
      return unconfigured(err.message)
    }
    throw err
  }

  // ── perform the call (timeout + 429/503 retry + one OAuth re-mint on 401) ─
  const hasBody = spec.body !== undefined && spec.method !== 'GET'
  if (hasBody) finalHeaders['Content-Type'] = 'application/json'

  const timeoutRow = await repo.findByKey('CONFIG', spec.group, spec.timeoutConfig)
  const retriesRow = await repo.findByKey('CONFIG', spec.group, spec.maxRetriesConfig)
  const timeoutMs = clampTimeoutMs(timeoutRow?.value)
  const maxRetries = clampMaxRetries(retriesRow?.value)
  // A partner that throttles us is only safe to re-send when the request is
  // idempotent; otherwise we would risk a duplicate write at the partner.
  const mayRetry = isIdempotent(spec.method, spec.mutating)

  const doRequest = (): Promise<Response> =>
    fetch(url, {
      method: spec.method,
      headers: finalHeaders,
      // Before this, a partner that accepted the connection and went quiet
      // burned the whole Lambda budget.
      signal: AbortSignal.timeout(timeoutMs),
      ...(hasBody ? { body: JSON.stringify(spec.body) } : {}),
    })

  try {
    let attempts = 0
    let retries = 0
    for (;;) {
      attempts += 1
      let response = await doRequest()

      if (response.status === 401 && cacheKey && remint) {
        // Clear BOTH tiers: a 401 means the partner killed the token early, so
        // leaving it in the shared row would let other containers keep
        // presenting it until its nominal expiry. The re-mint is deliberately
        // NOT charged against the retry budget — it is a different failure.
        await invalidateOutboundTokenEverywhere(cacheKey, sharedTier)
        finalHeaders.Authorization = `Bearer ${await remint()}`
        attempts += 1
        response = await doRequest()
      }

      if (!mayRetry || retries >= maxRetries || !isRetryableStatus(response.status)) {
        return { ok: true, response, attempts, url }
      }

      const delay = retryDelayMs(response.headers.get('retry-after'), retries, Date.now())
      logger.info('outbound call throttled — retrying', {
        integrationId,
        status: response.status,
        attempt: attempts,
        delayMs: delay,
      })
      retries += 1
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError; a caller-side abort
    // surfaces as AbortError. Both mean "no answer", which is a distinct
    // operational condition from "the call could not be made".
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        failure: {
          kind: 'upstreamTimeout',
          message: `partner did not respond within ${timeoutMs}ms`,
        },
      }
    }
    const message = err instanceof Error ? err.message : 'outbound call failed'
    return { ok: false, failure: { kind: 'upstreamError', message } }
  }
}
