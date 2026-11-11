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
import { requirePermission } from '../middleware/rbac'
import { meterUsage } from '../middleware/meter-usage'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { resolveIntegrationDefinition } from '../integration-validation/registry'
import { db as basePrisma } from '../db'
import { assertDeliverableUrl } from './integration-delivery'
import { buildBlobS3Key, newBlobId, getObjectBuffer, putObjectBuffer } from '../lib/documents-s3'
import { collectResponseHeaders, MAX_HEADER_VALUE } from '../lib/outbound-headers'
import {
  performOutboundCall,
  outboundFailureToHttp,
  resolveOutboundUrl,
  DEFAULT_API_KEY_HEADER,
} from '../lib/outbound-call'

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

type CallInput = z.infer<typeof CallBody>

// `resolveOutboundUrl` and `DEFAULT_API_KEY_HEADER` now live in lib/outbound-call
// (the extracted core owns URL building and the APIM default). Re-exported here
// because existing consumers — including this handler's own tests — import them
// from this module.
export { resolveOutboundUrl, DEFAULT_API_KEY_HEADER }

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
  meterUsage(Actions.CallExternal),
  validator('json', (value, c) => {
    const r = CallBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')

    // Resolve PER REQUEST against the DB (own → GLOBAL → built-in), the same way
    // the validate/map plane does (sdk-feedback 0038). The synchronous
    // `getIntegrationDefinition` reads a module-level overlay that only the four
    // config-mutation handlers ever warm, so on horizontally-scaled Lambda a
    // config-only integration (no built-in entry) resolved on whichever container
    // served the publish and 404'd on every other. Reads through `basePrisma`:
    // GLOBAL rows carry no tenantId, so the request-scoped client can filter them
    // out. Fails open to the built-in baseline on a DB error.
    if (!(await resolveIntegrationDefinition(basePrisma, integrationId, tenantId))) {
      return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
    }

    const input = c.req.valid('json') as CallInput

    // ── resolve any {"$blob": id} refs in the body to inline base64 ──────────
    // Stays HERE, not in the extracted core: blob refs are a call-external
    // input shape. A declarative fetch has no blob inputs.
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

    // ── the authenticated call itself (lib/outbound-call) ───────────────────
    // Config, the SSRF guard, all four auth modes, the secret-header overlay and
    // the timeout/retry/re-mint loop live in the shared core so the declarative
    // `fetch` endpoint performs the SAME transport. Failures come back typed and
    // map through one shared contract, so the (status, code) pairs this endpoint
    // has always returned are unchanged.
    const result = await performOutboundCall(
      { db: c.get('db'), tenantId, integrationId },
      {
        method: input.method,
        path: input.path,
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(outboundBody !== undefined ? { body: outboundBody } : {}),
        ...(input.mutating !== undefined ? { mutating: input.mutating } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        ...(input.secretHeaders !== undefined ? { secretHeaders: input.secretHeaders } : {}),
        group: input.group,
        baseUrlConfig: input.baseUrlConfig,
        authModeConfig: input.authModeConfig,
        tokenUrlConfig: input.tokenUrlConfig,
        clientIdSecret: input.clientIdSecret,
        clientSecretSecret: input.clientSecretSecret,
        bearerSecret: input.bearerSecret,
        apiKeyHeaderConfig: input.apiKeyHeaderConfig,
        timeoutConfig: input.timeoutConfig,
        maxRetriesConfig: input.maxRetriesConfig,
      },
      assertDeliverableUrl,
    )
    if (!result.ok) {
      const { status, body } = outboundFailureToHttp(result.failure)
      return c.json(body, status)
    }
    const { response, attempts } = result

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
