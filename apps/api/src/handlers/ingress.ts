// ---------------------------------------------------------------------------
// Inbound integration ingress (sdk-feedback 0021)
//
// Two surfaces:
//
//   ingressHandler  — the PUBLIC endpoint a third party (e.g. Sirva ADE) POSTs
//   to. Mounted PRE-TENANT (no session; the caller carries only a bearer the
//   platform issued). Auth resolves the tenant FROM the token, so it uses the
//   root `db` (cross-tenant), like the RingCentral webhook. It:
//     1. authenticates the bearer (prefix lookup + timing-safe hash compare);
//     2. loads the tenant's published `inbound` block (event type, dedup path,
//        ack template) off its IntegrationConfig;
//     3. dedups on the derived id (InboundEvent unique), persisting the raw body;
//     4. emits the configured DomainEvent (the ordinary EVENT dispatcher fires
//        the bound workflow — no new dispatch path);
//     5. returns the partner-shaped ack SYNCHRONOUSLY, derived from INGESTION
//        (accepted + durably queued), never waiting on the workflow.
//
//   ingressManagementHandler — the tenant/CLI surface to provision + rotate the
//   bearer. dualAuth + ManageIngress. The token is shown once at issue.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import crypto from 'node:crypto'
import { timingSafeEqual } from 'node:crypto'
import { db as rootDb } from '../db'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { DomainError } from '@pegasus/domain'
import {
  createIngressCredentialRepository,
  type IngressAuthRow,
} from '../repositories/ingress-credential.repository'
import {
  parseInboundConfig,
  deriveDedupId,
  defaultEventType,
  successAck,
  failureAck,
} from '../lib/ingress'

// ── public ingress endpoint ────────────────────────────────────────────────

export const ingressHandler = new Hono<AppEnv>()

/** Extract a `Bearer <token>` from the Authorization header, or null. */
function bearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const m = authHeader.match(/^Bearer\s+(\S+)$/i)
  return m ? (m[1] ?? null) : null
}

/** Timing-safe hash compare. */
function hashMatches(token: string, expectedHash: string): boolean {
  const actual = crypto.createHash('sha256').update(token).digest('hex')
  const a = Buffer.from(actual)
  const b = Buffer.from(expectedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Resolve the presented bearer to an enabled credential for this integration. */
async function authenticate(token: string, integrationId: string): Promise<IngressAuthRow | null> {
  const repo = createIngressCredentialRepository(rootDb)
  const rows = await repo.findByTokenPrefix(token.slice(0, 12))
  for (const row of rows) {
    if (row.integrationId === integrationId && row.enabled && hashMatches(token, row.tokenHash)) {
      return row
    }
  }
  return null
}

ingressHandler.post('/integrations/:integrationId/events', async (c) => {
  const integrationId = c.req.param('integrationId') ?? ''

  // 1. Authenticate the caller — resolves the tenant.
  const token = bearer(c.req.header('authorization'))
  if (!token) return c.json({ error: 'Missing bearer token' }, 401)
  const cred = await authenticate(token, integrationId)
  if (!cred) return c.json({ error: 'Invalid or expired token' }, 401)
  const tenantId = cred.tenantId

  // 2. Load the tenant's published inbound behaviour off its IntegrationConfig.
  const configRow = await rootDb.integrationConfig.findFirst({
    where: { integrationId, tenantId, status: 'PUBLISHED' },
    select: { inbound: true },
  })
  const inbound = parseInboundConfig(configRow?.inbound ?? null)
  const eventType = inbound.eventType ?? defaultEventType(integrationId)

  // 3. Parse the body. A malformed body is a delivery-level rejection: return the
  //    partner's Failed envelope with 200 (so the partner records the ack and
  //    does NOT retry an un-parseable payload).
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    logger.warn('Ingress rejected a malformed body', { integrationId, tenantId })
    return c.json(failureAck(inbound, ['malformed request body']), 200)
  }

  // 4. Dedup + persist + emit, atomically. A duplicate is a Success ack with no
  //    second emit; a first delivery emits the domain event the dispatcher fires.
  const externalId = deriveDedupId(payload, inbound.dedupKeyPath)
  try {
    await rootDb.$transaction(async (tx) => {
      // Emit the domain event first so we can back-link its id onto the receipt.
      const event = await tx.domainEvent.create({
        data: { tenantId, eventType, payload: payload as object },
        select: { id: true },
      })
      await tx.inboundEvent.create({
        data: {
          tenantId,
          integrationId,
          externalId,
          rawPayload: payload as object,
          status: 'accepted',
          domainEventId: event.id,
        },
      })
    })
    logger.info('Ingress accepted event', { integrationId, tenantId, externalId, eventType })
  } catch (err) {
    // Unique (tenant, integration, externalId) → redelivery. Idempotent: ack
    // Success, do not emit again.
    if ((err as { code?: string }).code === 'P2002') {
      logger.info('Ingress deduped a redelivered event', { integrationId, tenantId, externalId })
      return c.json(successAck(inbound), 200)
    }
    logger.error('Ingress failed to record event', {
      integrationId,
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json(failureAck(inbound, ['internal error recording the event']), 500)
  }

  // 5. Synchronous, ingestion-derived ack.
  return c.json(successAck(inbound), 200)
})

// ── management surface (provision / rotate / inspect the credential) ────────

export const ingressManagementHandler = new Hono<AppEnv>()

ingressManagementHandler.use('*', dualAuthMiddleware)

/** Build the public ingress URL for an integration. */
function ingressUrl(integrationId: string): string {
  const base = (process.env['INGRESS_PUBLIC_URL'] ?? '').replace(/\/+$/, '')
  return `${base}/api/ingress/v1/integrations/${integrationId}/events`
}

// POST /integrations/:integrationId/ingress — mint the first credential.
ingressManagementHandler.post(
  '/integrations/:integrationId/ingress',
  requirePermission(Actions.ManageIngress),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!tenantId || !userId) {
      throw new DomainError('Authenticated tenant user required', 'UNAUTHENTICATED')
    }
    const integrationId = c.req.param('integrationId') ?? ''
    const repo = createIngressCredentialRepository(c.get('db'))
    const issued = await repo.create({ tenantId, integrationId, createdByUserId: userId })
    if (!issued) {
      return c.json(
        { error: 'An ingress credential already exists — rotate it instead', code: 'CONFLICT' },
        409,
      )
    }
    logger.info('Ingress credential created', { integrationId, tenantId })
    return c.json(
      {
        data: {
          integrationId,
          url: ingressUrl(integrationId),
          token: issued.plainToken, // shown ONCE
          tokenPrefix: issued.meta.tokenPrefix,
          enabled: issued.meta.enabled,
        },
      },
      201,
    )
  },
)

// POST /integrations/:integrationId/ingress/rotate — mint a new token.
ingressManagementHandler.post(
  '/integrations/:integrationId/ingress/rotate',
  requirePermission(Actions.ManageIngress),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const repo = createIngressCredentialRepository(c.get('db'))
    const rotated = await repo.rotate(integrationId)
    if (!rotated) {
      return c.json({ error: 'No ingress credential to rotate', code: 'NOT_FOUND' }, 404)
    }
    logger.info('Ingress credential rotated', { integrationId, tenantId: c.get('tenantId') })
    return c.json({
      data: {
        integrationId,
        url: ingressUrl(integrationId),
        token: rotated.plainToken, // shown ONCE
        tokenPrefix: rotated.meta.tokenPrefix,
        enabled: rotated.meta.enabled,
      },
    })
  },
)

// GET /integrations/:integrationId/ingress — metadata (never the token).
ingressManagementHandler.get(
  '/integrations/:integrationId/ingress',
  requirePermission(Actions.ManageIngress),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const repo = createIngressCredentialRepository(c.get('db'))
    const meta = await repo.findMetaForScope(integrationId)
    if (!meta) return c.json({ error: 'No ingress credential', code: 'NOT_FOUND' }, 404)
    return c.json({
      data: {
        integrationId,
        url: ingressUrl(integrationId),
        tokenPrefix: meta.tokenPrefix,
        enabled: meta.enabled,
        createdAt: meta.createdAt.toISOString(),
        rotatedAt: meta.rotatedAt?.toISOString() ?? null,
      },
    })
  },
)
