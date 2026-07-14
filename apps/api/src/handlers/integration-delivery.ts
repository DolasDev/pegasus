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
import { getIntegrationDefinition } from '../integration-validation/registry'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { decryptSecretValue } from '../lib/secret-value-crypto'

const DeliverBody = z.object({
  /** The mapped partner payload to POST (typically a `map_to_external` result). */
  external: z.unknown(),
  /** Config key holding the delivery URL. Default `SEND_URL`. */
  urlConfig: z.string().min(1).max(128).default('SEND_URL'),
  /** Secret key holding the bearer API key. Default `SEND_API_KEY`. */
  apiKeySecret: z.string().min(1).max(128).default('SEND_API_KEY'),
  /** Optional config key holding extra headers as a JSON object string. */
  headersConfig: z.string().min(1).max(128).optional(),
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
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
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
    if (!getIntegrationDefinition(integrationId)) {
      return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
    }

    const { external, urlConfig, apiKeySecret, headersConfig, group } = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const repo = createWorkflowSecretConfigRepository(c.get('db'))

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

    let response: Response
    try {
      response = await fetch(urlRow.value, {
        method: 'POST',
        headers,
        body: JSON.stringify(external),
      })
    } catch (err) {
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
        dryRun: false,
      },
    })
  },
)
