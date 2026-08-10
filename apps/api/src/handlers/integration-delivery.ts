// ---------------------------------------------------------------------------
// /api/v1/integrations/:integrationId/deliver-to-external
//
// The mutating counterpart to the (open, read-only) map-to-external transform.
// A running workflow builds the partner body with `map_to_external`, then hands
// it here; the platform performs the outbound POST *server-side* using the
// workflow's own delivery URL (config) + API key (secret). Two reasons it lives
// here rather than as a raw `httpx.post` inside the activity:
//
//   1. Interceptable: raw outbound network from an activity is invisible to the
//      platform, so a dry run could not stop it. Routing delivery through a
//      PegasusClient method means the dry-run client captures it (and never
//      calls this endpoint) — the send flows through the one boundary dry-run
//      controls.
//   2. Author code shrinks: the workflow no longer imports httpx or reads the
//      URL/key itself — it names which config/secret hold them.
//
// The caller must hold the `DeliverToExternal` Cedar action (granted to
// workflow_runtime). Credentials stay tenant/workflow-scoped in the
// workflow-secrets-configs store (decision 2b) — no platform-held integration
// binding yet; `integrationId` is validated against the registry (404 on
// unknown) and recorded, and is the forward-compat hook for a future
// platform-held endpoint binding.
//
// SECURITY: this makes the API perform an outbound POST to a tenant-configured
// URL — an SSRF surface. `assertDeliverableUrl` rejects non-http(s) schemes and
// loopback/private/link-local hosts. This is a baseline guard, not full SSRF
// hardening (no DNS-rebinding protection / egress allowlist) — see
// sdk-feedback/0015 follow-ups.
//
// Failure modes:
//   400 VALIDATION_ERROR — bad body, or a disallowed delivery URL
//   403 Forbidden        — Cedar denies (no DeliverToExternal permission)
//   404 NOT_FOUND        — unknown integration, or the URL config / API-key
//                          secret is not set for the tenant
//   502 UPSTREAM_ERROR   — the outbound POST could not be completed (network)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { resolveIntegrationDefinition } from '../integration-validation/registry'
import { db as basePrisma } from '../db'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { decryptSecretValue } from '../lib/secret-value-crypto'
import {
  validateHeaderMaps,
  resolveOutboundHeaders,
  collectResponseHeaders,
  MissingHeaderSecretError,
  MAX_HEADER_VALUE,
} from '../lib/outbound-headers'
import { clampTimeoutMs } from '../lib/outbound-retry'

const DeliverBody = z.object({
  /** The mapped partner payload to POST (typically a `map_to_external` result). */
  external: z.unknown(),
  /** Config key holding the delivery URL. Default `SEND_URL`. */
  urlConfig: z.string().min(1).max(128).default('SEND_URL'),
  /** Secret key holding the bearer API key. Default `SEND_API_KEY`. */
  apiKeySecret: z.string().min(1).max(128).default('SEND_API_KEY'),
  /**
   * Optional config key holding extra headers as a JSON object string.
   *
   * NON-SECRET ONLY: a CONFIG row stores its value in plaintext. Use
   * `secretHeaders` for anything that is a credential — that is the whole
   * reason it exists.
   */
  headersConfig: z.string().min(1).max(128).optional(),
  /**
   * Extra request headers with LITERAL, non-secret values (e.g.
   * `{"On-Behalf-Of": "jdoe"}`). Reserved names are refused.
   */
  headers: z.record(z.string(), z.string().max(MAX_HEADER_VALUE)).optional(),
  /**
   * Extra request headers whose values are SECRET KEY NAMES, resolved
   * server-side from the tenant's encrypted store. This is the safe home for a
   * partner credential like `Ocp-Apim-Subscription-Key` — unlike
   * `headersConfig`, the value never sits in plaintext.
   */
  secretHeaders: z.record(z.string(), z.string().max(128)).optional(),
  /** Config key holding the request timeout in ms (clamped to [1000, 60000]). */
  timeoutConfig: z.string().min(1).max(128).default('REQUEST_TIMEOUT_MS'),
  /** Group the config/secret entries live in. Default `global`. */
  group: z.string().min(1).max(128).default('global'),
})

/**
 * Reject a delivery URL that is not a plain http(s) call to a public host.
 * Returns an error string, or null when the URL is allowed. Baseline SSRF guard
 * — blocks the obvious internal targets (loopback, RFC1918, link-local incl. the
 * cloud metadata endpoint); it does not defend against DNS rebinding.
 */
export function assertDeliverableUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'delivery URL is not a valid URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `delivery URL scheme ${url.protocol} is not allowed (use http/https)`
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')) {
    return 'delivery URL host is not allowed (loopback)'
  }
  // IPv4 literal in a private / loopback / link-local range.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return 'delivery URL host is not allowed (private/link-local address)'
    }
  }
  return null
}

export const integrationDeliveryHandler = new Hono<AppEnv>()

// Mounted on the m2mV1 router (no wildcard auth), so authenticate here — the
// workflow_runtime `vnd_` key must be accepted (same pattern as smsHandler).
integrationDeliveryHandler.use('*', dualAuthMiddleware)

integrationDeliveryHandler.post(
  '/integrations/:integrationId/deliver-to-external',
  requirePermission(Actions.DeliverToExternal),
  validator('json', (value, c) => {
    const r = DeliverBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')

    // Per-request DB resolution (own → GLOBAL → built-in) rather than the
    // module-level overlay — see the identical note in integration-call.ts
    // (sdk-feedback 0038). Both outbound handlers share this lookup, so both
    // 404'd on config-only integrations from any container that had not itself
    // served a config publish.
    if (!(await resolveIntegrationDefinition(basePrisma, integrationId, tenantId))) {
      return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
    }

    const input = c.req.valid('json')
    const { external, urlConfig, apiKeySecret, headersConfig, group } = input
    const repo = createWorkflowSecretConfigRepository(c.get('db'))

    // Reject bad custom headers before any config/secret read.
    const headerError = validateHeaderMaps(input)
    if (headerError) return c.json({ error: headerError, code: 'VALIDATION_ERROR' }, 400)

    const urlRow = await repo.findByKey('CONFIG', group, urlConfig)
    if (!urlRow || urlRow.value == null) {
      return c.json(
        { error: `Delivery URL config '${urlConfig}' is not set`, code: 'NOT_FOUND' },
        404,
      )
    }
    const urlError = assertDeliverableUrl(urlRow.value)
    if (urlError) return c.json({ error: urlError, code: 'VALIDATION_ERROR' }, 400)

    const secretRow = await repo.findByKey('SECRET', group, apiKeySecret)
    if (!secretRow || !secretRow.valueCiphertext) {
      return c.json(
        { error: `Delivery API-key secret '${apiKeySecret}' is not set`, code: 'NOT_FOUND' },
        404,
      )
    }
    const apiKey = await decryptSecretValue(secretRow.valueCiphertext, tenantId)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (headersConfig) {
      const extraRow = await repo.findByKey('CONFIG', group, headersConfig)
      if (extraRow?.value) {
        try {
          const extra = JSON.parse(extraRow.value) as Record<string, string>
          Object.assign(headers, extra)
        } catch {
          return c.json(
            { error: `Config '${headersConfig}' is not valid JSON`, code: 'VALIDATION_ERROR' },
            400,
          )
        }
      }
    }

    // Caller-supplied headers win over `headersConfig`, and resolved secrets win
    // over both — a plain entry must never shadow a credential.
    let finalHeaders: Record<string, string>
    try {
      finalHeaders = await resolveOutboundHeaders(headers, input, async (secretKey) => {
        const row = await repo.findByKey('SECRET', group, secretKey)
        if (!row?.valueCiphertext) return null
        return decryptSecretValue(row.valueCiphertext, tenantId)
      })
    } catch (err) {
      if (err instanceof MissingHeaderSecretError) {
        return c.json({ error: err.message, code: 'NOT_FOUND' }, 404)
      }
      throw err
    }

    const timeoutRow = await repo.findByKey('CONFIG', group, input.timeoutConfig)
    const timeoutMs = clampTimeoutMs(timeoutRow?.value)

    let response: Response
    try {
      response = await fetch(urlRow.value, {
        method: 'POST',
        headers: finalHeaders,
        // Delivery is always a mutation, so it is never auto-retried — but a
        // partner that goes quiet must still not burn the whole Lambda budget.
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(external),
      })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        return c.json(
          { error: `partner did not respond within ${timeoutMs}ms`, code: 'UPSTREAM_TIMEOUT' },
          504,
        )
      }
      const message = err instanceof Error ? err.message : 'delivery request failed'
      return c.json({ error: message, code: 'UPSTREAM_ERROR' }, 502)
    }

    const text = await response.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON partner response — return the raw text as-is.
    }

    return c.json({
      data: {
        delivered: response.ok,
        status: response.status,
        response: body,
        headers: collectResponseHeaders(response.headers),
        dryRun: false,
      },
    })
  },
)
