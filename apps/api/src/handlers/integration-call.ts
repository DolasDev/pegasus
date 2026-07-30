// ---------------------------------------------------------------------------
// /api/v1/integrations/:integrationId/call-external
//
// The generic authenticated outbound HTTP caller — the read/arbitrary-method
// counterpart to deliver-to-external (which is a single fixed JSON POST). A
// running workflow names a method + path (+ query/body); the platform performs
// the call *server-side* using the integration's configured BASE_URL and, for
// OAuth2 partners, a client-credentials token it mints, caches, and re-mints on
// 401 — so the workflow never holds client_id/client_secret and the send/read
// flows through the one boundary dry-run controls (sdk-feedback/0022).
//
// Config + credentials come from the tenant's WorkflowSecretConfig store (same
// place deliver-to-external reads SEND_URL/SEND_API_KEY, and where a workflow
// already reads e.g. its ADE queue name), keyed by config/secret name + group:
//   CONFIG  BASE_URL   — required; the outbound base URL
//   CONFIG  AUTH_MODE  — oauth2_client_credentials (default) | bearer | apikey | none
//   CONFIG  TOKEN_URL  — required for oauth2_client_credentials
//   SECRET  CLIENT_ID / CLIENT_SECRET — required for oauth2_client_credentials
//   SECRET  API_KEY    — required for bearer AND apikey
//   CONFIG  API_KEY_HEADER — apikey only; header name, default
//                            `Ocp-Apim-Subscription-Key`
//   CONFIG  REQUEST_TIMEOUT_MS / MAX_RETRIES — optional resilience tuning
// The default key names are overridable per call so one tenant can host several
// integrations in the same group.
//
// ── Azure API Management partners (docs/atlas-world-group-api) ──────────────
// APIM gateways authenticate with a NAMED HEADER, not a bearer, and commonly
// require a second per-request identity header. Atlas World Group is the
// motivating case: all 24 of its APIs accept only `Ocp-Apim-Subscription-Key`,
// and 142 of its 255 operations additionally declare `On-Behalf-Of`. Both are
// now expressible — `AUTH_MODE=apikey` for the credential, and the `headers` /
// `secretHeaders` request fields for everything else. See lib/outbound-headers
// for why those are two separate maps and which names are refused.
//
// Dry-run split (client-side, sdk-feedback/0015): a GET is a read and runs LIVE
// under `run --dry-run` (it reaches this endpoint); a POST/PUT/… is a mutation
// and is captured by the SDK client, which never calls this endpoint. This
// handler therefore always performs exactly the call it is asked to.
//
// SECURITY: the API performs an outbound call to a tenant-configured URL — an
// SSRF surface. `assertDeliverableUrl` (shared with deliver-to-external) rejects
// non-http(s) schemes and loopback/private/link-local hosts. Baseline guard, not
// full SSRF hardening (no DNS-rebinding defense).
//
// Failure modes:
//   400 VALIDATION_ERROR  — bad body, a disallowed resolved URL, or a rejected
//                           custom header (reserved name / illegal value)
//   403 Forbidden         — Cedar denies (no CallExternal permission)
//   404 NOT_FOUND         — unknown integration, or a required config/secret unset
//   502 UPSTREAM_ERROR    — token mint or outbound call could not be completed
//   504 UPSTREAM_TIMEOUT  — the partner did not respond within the timeout
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { requirePermission } from '../middleware/rbac'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { getIntegrationDefinition } from '../integration-validation/registry'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { createOutboundOAuthTokenRepository } from '../repositories/outbound-oauth-token.repository'
import { decryptSecretValue, encryptSecretValue } from '../lib/secret-value-crypto'
import { isOutboundOAuthSharedCacheEnabled } from '../lib/outbound-oauth-feature'
import { assertDeliverableUrl } from './integration-delivery'
import {
  acquireOutboundToken,
  invalidateOutboundTokenEverywhere,
  outboundTokenCacheKey,
  OutboundOAuthError,
  type SharedTokenTier,
} from '../services/outbound-oauth'
import { buildBlobS3Key, newBlobId, getObjectBuffer, putObjectBuffer } from '../lib/documents-s3'
import {
  validateHeaderMaps,
  resolveOutboundHeaders,
  collectResponseHeaders,
  MissingHeaderSecretError,
  MAX_HEADER_VALUE,
} from '../lib/outbound-headers'
import {
  isRetryableStatus,
  isIdempotent,
  retryDelayMs,
  clampMaxRetries,
  clampTimeoutMs,
} from '../lib/outbound-retry'

// Small-file ceiling for the blob<->Lambda paths (sdk-feedback/0025, phased):
// resolving a `{"$blob": id}` upload inline as base64, or landing a partner GET
// response into a blob, both round-trip the bytes THROUGH this Lambda, so they
// are bounded well under its payload limit. True 200 MB/2 GB streaming is the
// follow-up spec; put_blob/get_blob themselves (presigned, runner↔S3) are not
// bounded by this.
const INLINE_BLOB_MAX_BYTES = 5 * 1024 * 1024

/** A `{"$blob": "<id>"}` reference a workflow puts in a request body. */
function blobRefId(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)['$blob'] === 'string'
  ) {
    return (value as Record<string, string>)['$blob'] ?? null
  }
  return null
}

/**
 * Recursively replace every `{"$blob": id}` in a request body with the base64 of
 * that blob's bytes, fetched server-side (so the workflow never holds the file).
 * Enforces the inline size ceiling. Throws a tagged error the caller maps to a
 * 4xx/5xx.
 */
async function resolveBlobRefs(value: unknown, tenantId: string): Promise<unknown> {
  const id = blobRefId(value)
  if (id !== null) {
    const bytes = await getObjectBuffer(buildBlobS3Key(tenantId, id))
    if (bytes.length > INLINE_BLOB_MAX_BYTES) {
      throw new BlobError(
        `blob ${id} is ${bytes.length} bytes — over the ${INLINE_BLOB_MAX_BYTES}-byte inline cap`,
        413,
      )
    }
    return bytes.toString('base64')
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveBlobRefs(v, tenantId)))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await resolveBlobRefs(v, tenantId)
    return out
  }
  return value
}

/** Tagged error for blob resolution — maps to an HTTP status in the handler. */
class BlobError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BlobError'
  }
}

const CallBody = z.object({
  /** HTTP method to perform against the partner. */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Path appended to the integration's BASE_URL, e.g. `/OM/m1/GetShipmentDetail`. */
  path: z.string().min(1).max(2048),
  /** Optional query params. Values are stringified. */
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Optional JSON request body (mutations). */
  body: z.unknown().optional(),
  /**
   * Force read (`false`) / mutation (`true`) classification when a partner
   * overloads a method (e.g. a POST that only reads). Advisory only — the
   * dry-run capture split lives in the SDK client; the server still performs the
   * call. Recorded for observability.
   */
  mutating: z.boolean().optional(),
  /**
   * Land the partner response body into a new blob instead of returning it
   * inline (sdk-feedback/0025) — e.g. an ADE `GetImage` base64 payload. Returns
   * `{blobId, ...}`; the response bytes never sit in the workflow. Small-file cut.
   */
  responseToBlob: z.boolean().optional(),
  /**
   * Extra request headers with LITERAL values — non-secret by construction,
   * since they come from workflow code (e.g. `{"On-Behalf-Of": "jdoe"}`).
   * Reserved names (Authorization/Host/Content-Length/Content-Type) are refused.
   */
  headers: z.record(z.string(), z.string().max(MAX_HEADER_VALUE)).optional(),
  /**
   * Extra request headers whose values are SECRET KEY NAMES, resolved server-side
   * from the tenant's encrypted store (e.g.
   * `{"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"}`). This is how a partner
   * credential reaches the wire without ever entering workflow code.
   */
  secretHeaders: z.record(z.string(), z.string().max(128)).optional(),
  /** WorkflowSecretConfig group the config/secret entries live in. */
  group: z.string().min(1).max(128).default('global'),
  /** Config/secret key-name overrides (defaults suit a single-integration group). */
  baseUrlConfig: z.string().min(1).max(128).default('BASE_URL'),
  authModeConfig: z.string().min(1).max(128).default('AUTH_MODE'),
  tokenUrlConfig: z.string().min(1).max(128).default('TOKEN_URL'),
  clientIdSecret: z.string().min(1).max(128).default('CLIENT_ID'),
  clientSecretSecret: z.string().min(1).max(128).default('CLIENT_SECRET'),
  bearerSecret: z.string().min(1).max(128).default('API_KEY'),
  /** apikey mode: config holding the header name. */
  apiKeyHeaderConfig: z.string().min(1).max(128).default('API_KEY_HEADER'),
  /** Config keys holding the per-integration timeout / retry budget. */
  timeoutConfig: z.string().min(1).max(128).default('REQUEST_TIMEOUT_MS'),
  maxRetriesConfig: z.string().min(1).max(128).default('MAX_RETRIES'),
})

/** Default header name for `AUTH_MODE=apikey` — the Azure APIM convention. */
const DEFAULT_API_KEY_HEADER = 'Ocp-Apim-Subscription-Key'

type CallInput = z.infer<typeof CallBody>

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

/** Parse a partner response body as JSON, falling back to the raw text. */
function parseResponseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // XML / plain-text partner response (e.g. GetAgentComp XML) — return as-is.
    return text
  }
}

export const integrationCallHandler = new Hono<AppEnv>()

// Mounted on the m2mV1 router (no wildcard auth) — authenticate here, same as
// the delivery/SMS handlers. Gated by CallExternal (granted to workflow_runtime):
// unlike the open, side-effect-free map-to-external transform, this makes real
// authenticated outbound calls with tenant credentials, so it stays persona-scoped.
integrationCallHandler.use('*', dualAuthMiddleware)

integrationCallHandler.post(
  '/integrations/:integrationId/call-external',
  requirePermission(Actions.CallExternal),
  validator('json', (value, c) => {
    const r = CallBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    if (!getIntegrationDefinition(integrationId)) {
      return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
    }

    const input = c.req.valid('json') as CallInput
    const tenantId = c.get('tenantId')
    const repo = createWorkflowSecretConfigRepository(c.get('db'))

    // Reject bad custom headers BEFORE any config/secret read — a reserved name
    // or a CRLF-bearing value is a client error, not a lookup failure.
    const headerError = validateHeaderMaps(input)
    if (headerError) return c.json({ error: headerError, code: 'VALIDATION_ERROR' }, 400)

    // ── resolve config ──────────────────────────────────────────────────────
    const baseUrlRow = await repo.findByKey('CONFIG', input.group, input.baseUrlConfig)
    if (!baseUrlRow || baseUrlRow.value == null) {
      return c.json(
        { error: `Config '${input.baseUrlConfig}' (base URL) is not set`, code: 'NOT_FOUND' },
        404,
      )
    }
    const authModeRow = await repo.findByKey('CONFIG', input.group, input.authModeConfig)
    const authMode = (authModeRow?.value ?? 'oauth2_client_credentials').trim()

    const url = resolveOutboundUrl(baseUrlRow.value, input.path, input.query)
    const urlError = assertDeliverableUrl(url)
    if (urlError) return c.json({ error: urlError, code: 'VALIDATION_ERROR' }, 400)

    // ── resolve auth ────────────────────────────────────────────────────────
    // For OAuth we keep a re-mint closure so a 401 can invalidate + retry once.
    let cacheKey: string | null = null
    let remint: (() => Promise<string>) | null = null
    let sharedTier: SharedTokenTier | undefined
    const headers: Record<string, string> = { Accept: 'application/json' }

    if (authMode === 'oauth2_client_credentials') {
      const tokenUrlRow = await repo.findByKey('CONFIG', input.group, input.tokenUrlConfig)
      if (!tokenUrlRow || tokenUrlRow.value == null) {
        return c.json(
          { error: `Config '${input.tokenUrlConfig}' (token URL) is not set`, code: 'NOT_FOUND' },
          404,
        )
      }
      const idRow = await repo.findByKey('SECRET', input.group, input.clientIdSecret)
      const secretRow = await repo.findByKey('SECRET', input.group, input.clientSecretSecret)
      if (!idRow?.valueCiphertext || !secretRow?.valueCiphertext) {
        return c.json(
          {
            error: `Secrets '${input.clientIdSecret}'/'${input.clientSecretSecret}' are not set`,
            code: 'NOT_FOUND',
          },
          404,
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
          repo: createOutboundOAuthTokenRepository(c.get('db')),
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
          return c.json({ error: err.message, code: 'UPSTREAM_ERROR' }, 502)
        }
        throw err
      }
    } else if (authMode === 'bearer') {
      const keyRow = await repo.findByKey('SECRET', input.group, input.bearerSecret)
      if (!keyRow?.valueCiphertext) {
        return c.json(
          { error: `Secret '${input.bearerSecret}' (bearer) is not set`, code: 'NOT_FOUND' },
          404,
        )
      }
      headers.Authorization = `Bearer ${await decryptSecretValue(keyRow.valueCiphertext, tenantId)}`
    } else if (authMode === 'apikey') {
      // Azure APIM and friends: the credential is a named header, not a bearer.
      // The header NAME is config (non-secret); only the value is a secret.
      const keyRow = await repo.findByKey('SECRET', input.group, input.bearerSecret)
      if (!keyRow?.valueCiphertext) {
        return c.json(
          { error: `Secret '${input.bearerSecret}' (api key) is not set`, code: 'NOT_FOUND' },
          404,
        )
      }
      const nameRow = await repo.findByKey('CONFIG', input.group, input.apiKeyHeaderConfig)
      const headerName = (nameRow?.value ?? DEFAULT_API_KEY_HEADER).trim()
      // The name comes from tenant config, so it gets the same syntax + reserved
      // check as a caller-supplied header — otherwise `AUTH_MODE=apikey` with
      // `API_KEY_HEADER=Authorization` would quietly reintroduce the override
      // the reserved list exists to prevent.
      const nameError = validateHeaderMaps({ headers: { [headerName]: 'x' } })
      if (nameError) {
        return c.json(
          { error: `Config '${input.apiKeyHeaderConfig}': ${nameError}`, code: 'VALIDATION_ERROR' },
          400,
        )
      }
      headers[headerName] = await decryptSecretValue(keyRow.valueCiphertext, tenantId)
    } else if (authMode !== 'none') {
      return c.json({ error: `Unsupported AUTH_MODE '${authMode}'`, code: 'VALIDATION_ERROR' }, 400)
    }

    // ── overlay the caller's custom headers ─────────────────────────────────
    let finalHeaders: Record<string, string>
    try {
      finalHeaders = await resolveOutboundHeaders(headers, input, async (secretKey) => {
        const row = await repo.findByKey('SECRET', input.group, secretKey)
        if (!row?.valueCiphertext) return null
        return decryptSecretValue(row.valueCiphertext, tenantId)
      })
    } catch (err) {
      if (err instanceof MissingHeaderSecretError) {
        return c.json({ error: err.message, code: 'NOT_FOUND' }, 404)
      }
      throw err
    }

    // ── resolve any {"$blob": id} refs in the body to inline base64 ──────────
    let outboundBody = input.body
    if (input.body !== undefined) {
      try {
        outboundBody = await resolveBlobRefs(input.body, tenantId)
      } catch (err) {
        if (err instanceof BlobError)
          return c.json({ error: err.message, code: 'BLOB_ERROR' }, err.status as 413)
        // A missing/expired blob surfaces from S3 GetObject.
        return c.json({ error: 'referenced blob not found or unreadable', code: 'NOT_FOUND' }, 404)
      }
    }

    // ── perform the call (timeout + 429/503 retry + one OAuth re-mint on 401) ─
    const hasBody = outboundBody !== undefined && input.method !== 'GET'
    if (hasBody) finalHeaders['Content-Type'] = 'application/json'

    const timeoutRow = await repo.findByKey('CONFIG', input.group, input.timeoutConfig)
    const retriesRow = await repo.findByKey('CONFIG', input.group, input.maxRetriesConfig)
    const timeoutMs = clampTimeoutMs(timeoutRow?.value)
    const maxRetries = clampMaxRetries(retriesRow?.value)
    // A partner that throttles us is only safe to re-send when the request is
    // idempotent; otherwise we would risk a duplicate write at the partner.
    const mayRetry = isIdempotent(input.method, input.mutating)

    const doRequest = (): Promise<Response> =>
      fetch(url, {
        method: input.method,
        headers: finalHeaders,
        // Before this, a partner that accepted the connection and went quiet
        // burned the whole Lambda budget.
        signal: AbortSignal.timeout(timeoutMs),
        ...(hasBody ? { body: JSON.stringify(outboundBody) } : {}),
      })

    /** Run the request, re-minting once on 401 and retrying 429/503 per policy. */
    const performWithRetries = async (): Promise<{ response: Response; attempts: number }> => {
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
          return { response, attempts }
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
    }

    let response: Response
    let attempts: number
    try {
      ;({ response, attempts } = await performWithRetries())
    } catch (err) {
      // AbortSignal.timeout rejects with a TimeoutError; a caller-side abort
      // surfaces as AbortError. Both mean "no answer", which is a distinct
      // operational condition from "the call could not be made".
      const name = err instanceof Error ? err.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        return c.json(
          {
            error: `partner did not respond within ${timeoutMs}ms`,
            code: 'UPSTREAM_TIMEOUT',
          },
          504,
        )
      }
      const message = err instanceof Error ? err.message : 'outbound call failed'
      return c.json({ error: message, code: 'UPSTREAM_ERROR' }, 502)
    }

    const contentType = response.headers.get('content-type') ?? undefined
    const responseHeaders = collectResponseHeaders(response.headers)

    // ── response_to_blob: land the body into a blob instead of returning it ──
    if (input.responseToBlob) {
      const buf = Buffer.from(await response.arrayBuffer())
      if (buf.length > INLINE_BLOB_MAX_BYTES) {
        return c.json(
          {
            error: `response is ${buf.length} bytes — over the ${INLINE_BLOB_MAX_BYTES}-byte inline cap`,
            code: 'BLOB_ERROR',
          },
          413,
        )
      }
      const blobId = newBlobId()
      await putObjectBuffer(
        buildBlobS3Key(tenantId, blobId),
        buf,
        contentType ?? 'application/octet-stream',
      )
      return c.json({
        data: {
          status: response.status,
          ok: response.ok,
          blobId,
          size: buf.length,
          headers: responseHeaders,
          attempts,
          dryRun: false,
        },
      })
    }

    const text = await response.text()
    return c.json({
      data: {
        status: response.status,
        ok: response.ok,
        response: parseResponseBody(text),
        headers: responseHeaders,
        attempts,
        dryRun: false,
      },
    })
  },
)
