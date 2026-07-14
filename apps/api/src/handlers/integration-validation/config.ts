// ---------------------------------------------------------------------------
// Integration-validator config — publish / dry-run validate / versions / rollback.
//
// The DB-backed authoring surface for an integration's mapping + rules. Mounted
// on the M2M v1 plane (vnd_ keys via dualAuthMiddleware) and RBAC-gated:
//   - PublishIntegrationConfig — validate (dry-run), publish, rollback
//   - ReadIntegrationConfig    — get active config, list versions
//
// Every publish runs the deterministic gate pipeline (static checks + golden
// corpus) BEFORE persisting; a failure returns 422 with the full report and
// writes nothing. Visibility is derived server-side from the publishing tenant's
// isPlatformTenant flag (GLOBAL for the platform tenant, TENANT otherwise) —
// exactly like the workflows store. Both scopes drive the live validator:
// resolveIntegrationDefinition applies a tenant's own config over GLOBAL over the
// built-in baseline, per request. On success the GLOBAL overlay cache is also
// refreshed so the platform-scoped (null-tenant) validate path picks up a GLOBAL
// publish immediately. Mutations are gated behind INTEGRATION_CONFIG_PUBLISH_ENABLED.
//
// There is no tenant-plane audit table (writeAuditLog is admin-only); publish
// and rollback emit a structured logger.info, the convention on this plane.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import { requirePermission } from '../../middleware/rbac'
import { dualAuthMiddleware } from '../../middleware/dual-auth'
import { Actions } from '../../authz/actions'
import type { AppEnv } from '../../types'
import { db as basePrisma } from '../../db'
import {
  createIntegrationConfigRepository,
  type IntegrationConfigRow,
} from '../../repositories/integration-config.repository'
import { getBuiltInDefinition, refreshRegistryOverlay } from '../../integration-validation/registry'
import { runGatePipeline, type GateCorpusCase } from '../../integration-validation/gate-pipeline'
import { isIntegrationConfigPublishEnabled } from '../../lib/integration-config-feature'
import type { Prisma } from '@prisma/client'
import { logger } from '../../lib/logger'

const CorpusCaseSchema = z.object({
  name: z.string().min(1),
  input: z.object({
    order: z.unknown(),
    prior: z.unknown().optional(),
    action: z.enum(['save', 'cancel', 'status-change']).optional(),
  }),
  expected: z.object({ valid: z.boolean(), ruleIds: z.array(z.string()) }),
})

// mapping + rules are intentionally `unknown` — the gate pipeline validates them
// against the published schemas and reports problems; the HTTP layer doesn't
// pre-judge their shape.
const ConfigBody = z.object({
  mapping: z.unknown(),
  rules: z.unknown(),
  corpus: z.array(CorpusCaseSchema),
})

export const integrationConfigHandler = new Hono<AppEnv>()

integrationConfigHandler.use('*', dualAuthMiddleware)

/** Full projection — includes the editable surface so the CLI `pull` can round-trip. */
function toFull(row: IntegrationConfigRow) {
  return {
    id: row.id,
    integrationId: row.integrationId,
    version: row.version,
    visibility: row.visibility,
    status: row.status,
    mapping: row.mapping,
    rules: row.rules,
    corpus: row.corpus,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt,
  }
}

/** Compact projection for version listings (omits the large JSON blobs). */
function toSummary(row: IntegrationConfigRow) {
  return {
    id: row.id,
    integrationId: row.integrationId,
    version: row.version,
    visibility: row.visibility,
    status: row.status,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt,
  }
}

function featureDisabled(): boolean {
  return !isIntegrationConfigPublishEnabled()
}

// POST /integrations/:id/config/validate — dry-run gate, no write.
integrationConfigHandler.post(
  '/integrations/:integrationId/config/validate',
  requirePermission(Actions.PublishIntegrationConfig),
  validator('json', (value, c) => {
    const r = ConfigBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const base = getBuiltInDefinition(integrationId)
    if (!base)
      return c.json({ error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND' }, 404)
    const { mapping, rules, corpus } = c.req.valid('json')
    const report = runGatePipeline(base, { mapping, rules, corpus: corpus as GateCorpusCase[] })
    return c.json({ data: report })
  },
)

// POST /integrations/:id/config — finalize: gate -> publish -> refresh overlay.
integrationConfigHandler.post(
  '/integrations/:integrationId/config',
  requirePermission(Actions.PublishIntegrationConfig),
  validator('json', (value, c) => {
    const r = ConfigBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    if (featureDisabled()) {
      return c.json(
        { error: 'Integration config publishing is not enabled', code: 'FEATURE_DISABLED' },
        403,
      )
    }
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
    const userId = c.get('userId')
    if (!userId)
      throw new DomainError('Authenticated user required to publish config', 'UNAUTHENTICATED')

    const base = getBuiltInDefinition(integrationId)
    if (!base)
      return c.json({ error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND' }, 404)

    const { mapping, rules, corpus } = c.req.valid('json')
    const report = runGatePipeline(base, { mapping, rules, corpus: corpus as GateCorpusCase[] })
    if (!report.ok) {
      return c.json(
        { error: 'Config failed the validation gate', code: 'GATE_FAILED', report },
        422,
      )
    }

    const db = c.get('db')
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { isPlatformTenant: true },
    })
    if (!tenant) throw new DomainError('Tenant not found', 'NOT_FOUND')
    const visibility = tenant.isPlatformTenant ? 'GLOBAL' : 'TENANT'

    const repo = createIntegrationConfigRepository(db)
    const row = await repo.publish({
      integrationId,
      tenantId,
      visibility,
      mapping: mapping as Prisma.InputJsonValue,
      rules: rules as Prisma.InputJsonValue,
      corpus: corpus as unknown as Prisma.InputJsonValue,
      gateReport: report as unknown as Prisma.InputJsonValue,
      publishedBy: userId,
    })

    await refreshRegistryOverlay(basePrisma)
    logger.info('integration config published', {
      integrationId,
      tenantId,
      version: row.version,
      visibility,
    })
    return c.json({ data: toFull(row) }, 201)
  },
)

// GET /integrations/:id/config — the active config for the caller's scope.
integrationConfigHandler.get(
  '/integrations/:integrationId/config',
  requirePermission(Actions.ReadIntegrationConfig),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
    const repo = createIntegrationConfigRepository(c.get('db'))
    const row = await repo.findActiveForScope(integrationId, tenantId)
    if (!row) return c.json({ error: 'No published config', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toFull(row) })
  },
)

// GET /integrations/:id/config/versions — version history for the caller's scope.
integrationConfigHandler.get(
  '/integrations/:integrationId/config/versions',
  requirePermission(Actions.ReadIntegrationConfig),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
    const repo = createIntegrationConfigRepository(c.get('db'))
    const rows = await repo.listVersions(integrationId, tenantId)
    return c.json({ data: rows.map(toSummary), meta: { count: rows.length } })
  },
)

// POST /integrations/:id/config/rollback/:version — re-publish a prior version.
integrationConfigHandler.post(
  '/integrations/:integrationId/config/rollback/:version',
  requirePermission(Actions.PublishIntegrationConfig),
  async (c) => {
    if (featureDisabled()) {
      return c.json(
        { error: 'Integration config publishing is not enabled', code: 'FEATURE_DISABLED' },
        403,
      )
    }
    const integrationId = c.req.param('integrationId') ?? ''
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
    const userId = c.get('userId')
    if (!userId)
      throw new DomainError('Authenticated user required to publish config', 'UNAUTHENTICATED')

    const version = Number.parseInt(c.req.param('version') ?? '', 10)
    if (!Number.isInteger(version) || version < 1) {
      return c.json({ error: 'Invalid version', code: 'VALIDATION_ERROR' }, 400)
    }

    const base = getBuiltInDefinition(integrationId)
    if (!base)
      return c.json({ error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND' }, 404)

    const db = c.get('db')
    const repo = createIntegrationConfigRepository(db)
    const source = await repo.findVersion(integrationId, tenantId, version)
    if (!source) return c.json({ error: `Version ${version} not found`, code: 'NOT_FOUND' }, 404)

    // Re-run the gate: a config that passed when published may no longer pass if
    // the canonical contract has since changed in code. Rolling back must not
    // resurrect a now-invalid config.
    const report = runGatePipeline(base, {
      mapping: source.mapping,
      rules: source.rules,
      corpus: source.corpus as unknown as GateCorpusCase[],
    })
    if (!report.ok) {
      return c.json(
        { error: 'Rolled-back config no longer passes the gate', code: 'GATE_FAILED', report },
        422,
      )
    }

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { isPlatformTenant: true },
    })
    if (!tenant) throw new DomainError('Tenant not found', 'NOT_FOUND')
    const visibility = tenant.isPlatformTenant ? 'GLOBAL' : 'TENANT'

    const row = await repo.publish({
      integrationId,
      tenantId,
      visibility,
      mapping: source.mapping as Prisma.InputJsonValue,
      rules: source.rules as Prisma.InputJsonValue,
      corpus: source.corpus as Prisma.InputJsonValue,
      gateReport: report as unknown as Prisma.InputJsonValue,
      publishedBy: userId,
    })

    await refreshRegistryOverlay(basePrisma)
    logger.info('integration config rolled back', {
      integrationId,
      tenantId,
      fromVersion: version,
      newVersion: row.version,
    })
    return c.json({ data: toFull(row) }, 201)
  },
)
