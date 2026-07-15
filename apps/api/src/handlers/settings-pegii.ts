// ---------------------------------------------------------------------------
// pegII settings handler — /api/v1/settings/pegii
//
// Lets tenant administrators configure the pegII on-prem domain API binding:
// the per-entity data source flag (customerSource), the pegII API base URL, and
// a credential reference. Mounted alongside settingsHandler on /settings.
//
// Endpoints:
//   GET   /pegii       — current config (credential presence only, never value)
//   PATCH /pegii       — update customerSource / base URL / credential ref
//   POST  /pegii/test  — connectivity probe over the tunnel (open GET /health,
//                        expects a bare {"status":"healthy"} body)
//
// The credential (pegiiApiKeyRef) is a Secrets Manager ARN, stored by
// reference. It is NEVER returned by any response — GET/PATCH only report
// whether one is configured.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { db } from '../db'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import { normalizeCustomerSource } from '../lib/customer-source-config'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { createPegiiApiClient, PegiiApiError } from '../lib/pegii-api-client'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const PatchPegiiBody = z
  .object({
    customerSource: z.enum(['prisma', 'pegii']).nullable().optional(),
    pegiiApiBaseUrl: z.string().url().nullable().optional(),
    pegiiApiKeyRef: z.string().min(1).nullable().optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Connectivity-probe result
// ---------------------------------------------------------------------------

export type PegiiTestCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'PEER_INACTIVE'
  | 'TUNNEL_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_ENVELOPE'

export interface PegiiTestResult {
  ok: boolean
  code: PegiiTestCode
  detail: string
  elapsedMs: number
}

function classifyPegiiError(err: unknown): { code: PegiiTestCode; detail: string } {
  if (err instanceof PegiiApiError) {
    switch (err.code) {
      case 'PEGII_API_NOT_CONFIGURED':
        return {
          code: 'NOT_CONFIGURED',
          detail: 'No pegII API base URL is configured for this tenant.',
        }
      case 'PEGII_API_TUNNEL_ERROR':
        return {
          code: 'TUNNEL_ERROR',
          detail:
            'Could not reach the pegII API over the tunnel. Verify the WireGuard peer is active and ' +
            `the on-prem service is listening. (${err.message})`,
        }
      case 'PEGII_API_HTTP_ERROR':
        return { code: 'HTTP_ERROR', detail: `The pegII API returned an error: ${err.message}` }
      case 'PEGII_API_BAD_ENVELOPE':
        return {
          code: 'BAD_ENVELOPE',
          detail: `Unexpected response from the pegII API: ${err.message}`,
        }
    }
  }
  return { code: 'HTTP_ERROR', detail: err instanceof Error ? err.message : String(err) }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const settingsPegiiHandler = new Hono<AppEnv>()

// GET /pegii — current config. Credential is reported as a boolean only.
settingsPegiiHandler.get('/pegii', requirePermission(Actions.ReadSettings), async (c) => {
  const tenantId = c.get('tenantId')
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { customerSource: true, pegiiApiBaseUrl: true, pegiiApiKeyRef: true },
  })
  if (!tenant) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)

  return c.json({
    data: {
      customerSource: normalizeCustomerSource(tenant.customerSource),
      pegiiApiBaseUrl: tenant.pegiiApiBaseUrl,
      pegiiApiKeyConfigured: tenant.pegiiApiKeyRef != null,
    },
  })
})

// PATCH /pegii — sparse update of the three fields. Pass null to clear a field.
settingsPegiiHandler.patch(
  '/pegii',
  requirePermission(Actions.UpdateSettings),
  validator('json', (value, c) => {
    const r = PatchPegiiBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')

    const tenant = await db.tenant.update({
      where: { id: tenantId },
      data: {
        ...(body.customerSource !== undefined ? { customerSource: body.customerSource } : {}),
        ...(body.pegiiApiBaseUrl !== undefined ? { pegiiApiBaseUrl: body.pegiiApiBaseUrl } : {}),
        ...(body.pegiiApiKeyRef !== undefined ? { pegiiApiKeyRef: body.pegiiApiKeyRef } : {}),
      },
      select: { customerSource: true, pegiiApiBaseUrl: true, pegiiApiKeyRef: true },
    })

    logger.info('pegII settings updated', {
      tenantId,
      sections: Object.keys(body),
      customerSource: tenant.customerSource,
    })
    return c.json({
      data: {
        customerSource: normalizeCustomerSource(tenant.customerSource),
        pegiiApiBaseUrl: tenant.pegiiApiBaseUrl,
        pegiiApiKeyConfigured: tenant.pegiiApiKeyRef != null,
      },
    })
  },
)

// POST /pegii/test — connectivity probe. Always HTTP 200; verdict in the body.
settingsPegiiHandler.post('/pegii/test', requirePermission(Actions.ReadSettings), async (c) => {
  const tenantId = c.get('tenantId')
  const startedAt = Date.now()

  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    const code: PegiiTestCode =
      resolved.code === 'PEGII_API_PEER_INACTIVE' ? 'PEER_INACTIVE' : 'NOT_CONFIGURED'
    const result: PegiiTestResult = { ok: false, code, detail: resolved.message, elapsedMs: 0 }
    return c.json({ data: result })
  }

  const client = createPegiiApiClient({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
    timeoutMs: 10_000,
  })

  try {
    const health = await client.getHealth()
    const elapsedMs = Date.now() - startedAt

    // The pegII team's /health returns a bare `{"status":"healthy"}`. Reaching
    // it at all proves connectivity; a status that is present but not "healthy"
    // means the service answered but reports itself degraded.
    if (typeof health.status === 'string' && health.status !== 'healthy') {
      logger.warn('pegII connection test reported unhealthy', {
        tenantId,
        status: health.status,
        elapsedMs,
      })
      const result: PegiiTestResult = {
        ok: false,
        code: 'HTTP_ERROR',
        detail: `Reached the pegII API, but it reported status "${health.status}".`,
        elapsedMs,
      }
      return c.json({ data: result })
    }

    logger.info('pegII connection test succeeded', { tenantId, elapsedMs })
    const result: PegiiTestResult = {
      ok: true,
      code: 'OK',
      detail: `Connected — pegII API responded in ${elapsedMs} ms.`,
      elapsedMs,
    }
    return c.json({ data: result })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    const { code, detail } = classifyPegiiError(err)
    logger.warn('pegII connection test failed', { tenantId, code, elapsedMs, error: String(err) })
    const result: PegiiTestResult = { ok: false, code, detail, elapsedMs }
    return c.json({ data: result })
  }
})
