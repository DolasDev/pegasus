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
//   CONFIG  AUTH_MODE  — oauth2_client_credentials (default) | bearer | none
//   CONFIG  TOKEN_URL  — required for oauth2_client_credentials
//   SECRET  CLIENT_ID / CLIENT_SECRET — required for oauth2_client_credentials
//   SECRET  API_KEY    — required for bearer
// The default key names are overridable per call so one tenant can host several
// integrations in the same group.
//
// Dry-run split (client-side, sdk-feedback/0015): a GET is a read and runs LIVE
// under `run --dry-run` (it reaches this endpoint); a POST/PUT/… is a mutation
// and is captured by the SDK client, which never calls this endpoint. This
// handler therefore always performs exactly the call it is asked to.
//
// SECURITY: the API performs an outbound call to a tenant-configured URL — an
// SSRF surface. `assertDeliverableUrl` (shared with deliver-to-external) rejects
// non-http(s) schemes and loopback/private/link-local hosts. Baseline guard, not
// full SSRF hardening (no DNS-rebinding defence).
//
// Failure modes:
//   400 VALIDATION_ERROR — bad body, or a disallowed resolved URL
//   403 Forbidden        — Cedar denies (no CallExternal permission)
//   404 NOT_FOUND        — unknown integration, or a required config/secret unset
//   502 UPSTREAM_ERROR   — token mint or outbound call could not be completed
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { getIntegrationDefinition } from '../integration-validation/registry'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { decryptSecretValue } from '../lib/secret-value-crypto'
import { assertDeliverableUrl } from './integration-delivery'
import {
  acquireOutboundToken,
  invalidateOutboundToken,
  outboundTokenCacheKey,
  OutboundOAuthError,
} from '../services/outbound-oauth'

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
  /** WorkflowSecretConfig group the config/secret entries live in. */
  group: z.string().min(1).max(128).default('global'),
  /** Config/secret key-name overrides (defaults suit a single-integration group). */
  baseUrlConfig: z.string().min(1).max(128).default('BASE_URL'),
  authModeConfig: z.string().min(1).max(128).default('AUTH_MODE'),
  tokenUrlConfig: z.string().min(1).max(128).default('TOKEN_URL'),
  clientIdSecret: z.string().min(1).max(128).default('CLIENT_ID'),
  clientSecretSecret: z.string().min(1).max(128).default('CLIENT_SECRET'),
  bearerSecret: z.string().min(1).max(128).default('API_KEY'),
})

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
      remint = () => acquireOutboundToken(cacheKey!, cfg)
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
    } else if (authMode !== 'none') {
      return c.json({ error: `Unsupported AUTH_MODE '${authMode}'`, code: 'VALIDATION_ERROR' }, 400)
    }

    // ── perform the call (with one OAuth re-mint on 401) ─────────────────────
    const hasBody = input.body !== undefined && input.method !== 'GET'
    if (hasBody) headers['Content-Type'] = 'application/json'

    const doRequest = (): Promise<Response> =>
      fetch(url, {
        method: input.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
      })

    let response: Response
    try {
      response = await doRequest()
      if (response.status === 401 && cacheKey && remint) {
        invalidateOutboundToken(cacheKey)
        headers.Authorization = `Bearer ${await remint()}`
        response = await doRequest()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'outbound call failed'
      return c.json({ error: message, code: 'UPSTREAM_ERROR' }, 502)
    }

    const text = await response.text()
    return c.json({
      data: {
        status: response.status,
        ok: response.ok,
        response: parseResponseBody(text),
        headers: { 'content-type': response.headers.get('content-type') ?? undefined },
        dryRun: false,
      },
    })
  },
)
