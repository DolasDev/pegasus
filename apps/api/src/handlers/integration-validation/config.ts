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
import {
  getGateBase,
  getFloor,
  refreshRegistryOverlay,
} from '../../integration-validation/registry'
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

// mapping + rules + externalMapping are intentionally `unknown` — the gate
// pipeline validates them against the published schemas and reports problems;
// the HTTP layer doesn't pre-judge their shape. `floor` (0020) selects the type
// floor (required for a NEW partner id with no built-in), `displayName` (0019) is
// the human-facing label, and `externalShape`/`externalMapping` (0020) carry the
// partner's own external output shape + projection.
const ConfigBody = z.object({
  mapping: z.unknown(),
  rules: z.unknown(),
  corpus: z.array(CorpusCaseSchema),
  floor: z.string().min(1).optional(),
  displayName: z.string().min(1).max(200).optional(),
  externalShape: z.record(z.string(), z.unknown()).optional(),
  externalMapping: z.unknown().optional(),
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
    floor: row.floor,
    displayName: row.displayName,
    externalShape: row.externalShape,
    externalMapping: row.externalMapping,
    publishedBy: row.publishedBy,
    forkedFromConfigId: row.forkedFromConfigId,
    forkedFromVersion: row.forkedFromVersion,
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
    floor: row.floor,
    displayName: row.displayName,
    publishedBy: row.publishedBy,
    forkedFromConfigId: row.forkedFromConfigId,
    forkedFromVersion: row.forkedFromVersion,
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
    const { mapping, rules, corpus, floor, externalShape, externalMapping } = c.req.valid('json')
    if (floor && !getFloor(floor))
      return c.json({ error: `Unknown floor "${floor}"`, code: 'NOT_FOUND' }, 404)
    const base = getGateBase(integrationId, floor)
    if (!base)
      return c.json(
        {
          error: `Unknown integration "${integrationId}" — pass "floor" to target a type floor`,
          code: 'NOT_FOUND',
        },
        404,
      )
    const report = runGatePipeline(base, {
      mapping,
      rules,
      corpus: corpus as GateCorpusCase[],
      ...(externalShape ? { externalShape } : {}),
      ...(externalMapping !== undefined ? { externalMapping } : {}),
    })
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

    const { mapping, rules, corpus, floor, displayName, externalShape, externalMapping } =
      c.req.valid('json')
    if (floor && !getFloor(floor))
      return c.json({ error: `Unknown floor "${floor}"`, code: 'NOT_FOUND' }, 404)
    const base = getGateBase(integrationId, floor)
    if (!base)
      return c.json(
        {
          error: `Unknown integration "${integrationId}" — pass "floor" to target a type floor`,
          code: 'NOT_FOUND',
        },
        404,
      )

    const report = runGatePipeline(base, {
      mapping,
      rules,
      corpus: corpus as GateCorpusCase[],
      ...(externalShape ? { externalShape } : {}),
      ...(externalMapping !== undefined ? { externalMapping } : {}),
    })
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
      // Persist the floor/overlay fields (0019 + 0020). `floor` falls back to the
      // gate base's floor so a built-in-id publish records its type explicitly.
      floor: floor ?? base.floor,
      ...(displayName ? { displayName } : {}),
      ...(externalShape ? { externalShape: externalShape as Prisma.InputJsonValue } : {}),
      ...(externalMapping !== undefined
        ? { externalMapping: externalMapping as Prisma.InputJsonValue }
        : {}),
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

    const db = c.get('db')
    const repo = createIntegrationConfigRepository(db)
    const source = await repo.findVersion(integrationId, tenantId, version)
    if (!source) return c.json({ error: `Version ${version} not found`, code: 'NOT_FOUND' }, 404)

    const base = getGateBase(integrationId, source.floor ?? undefined)
    if (!base)
      return c.json({ error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND' }, 404)

    // Re-run the gate: a config that passed when published may no longer pass if
    // the canonical contract has since changed in code. Rolling back must not
    // resurrect a now-invalid config.
    const report = runGatePipeline(base, {
      mapping: source.mapping,
      rules: source.rules,
      corpus: source.corpus as unknown as GateCorpusCase[],
      ...(source.externalShape != null && typeof source.externalShape === 'object'
        ? { externalShape: source.externalShape as Record<string, unknown> }
        : {}),
      ...(source.externalMapping != null ? { externalMapping: source.externalMapping } : {}),
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
      ...(source.floor ? { floor: source.floor } : {}),
      ...(source.displayName ? { displayName: source.displayName } : {}),
      ...(source.externalShape != null
        ? { externalShape: source.externalShape as Prisma.InputJsonValue }
        : {}),
      ...(source.externalMapping != null
        ? { externalMapping: source.externalMapping as Prisma.InputJsonValue }
        : {}),
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

// POST /integrations/:id/config/fork — fork the platform (GLOBAL) config into the
// caller's tenant scope: copy its mapping/rules/corpus, re-run the gate against the
// current built-in, and publish it as the tenant's own TENANT config (v1) stamped
// with fork provenance. Mirrors the workflow "fork to my store" flow. Reuses the
// PublishIntegrationConfig permission and the INTEGRATION_CONFIG_PUBLISH_ENABLED flag.
integrationConfigHandler.post(
  '/integrations/:integrationId/config/fork',
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

    const db = c.get('db')
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { isPlatformTenant: true },
    })
    if (!tenant) throw new DomainError('Tenant not found', 'NOT_FOUND')
    // The platform tenant owns GLOBAL configs; forking GLOBAL into its own scope
    // is nonsensical (it would fork a config into the tenant that already owns it).
    if (tenant.isPlatformTenant) {
      return c.json(
        {
          error: 'The platform tenant cannot fork its own GLOBAL config',
          code: 'PLATFORM_TENANT_CANNOT_FORK',
        },
        400,
      )
    }

    const repo = createIntegrationConfigRepository(db)

    // Refuse to clobber an existing tenant customization — publishing would
    // otherwise supersede their own config with a copy of GLOBAL.
    const own = await repo.findActiveOwn(integrationId, tenantId)
    if (own) {
      return c.json(
        {
          error: 'This tenant already has its own config for this integration',
          code: 'CONFLICT',
        },
        409,
      )
    }

    const source = await repo.findActiveGlobal(integrationId)
    if (!source) {
      return c.json(
        { error: `No platform config published for "${integrationId}"`, code: 'NOT_FOUND' },
        404,
      )
    }

    const base = getGateBase(integrationId, source.floor ?? undefined)
    if (!base)
      return c.json({ error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND' }, 404)

    // Re-run the gate against the CURRENT floor: a GLOBAL config that passed when
    // published may no longer pass if the canonical contract has since changed in
    // code. Forking must not resurrect a now-invalid config.
    const report = runGatePipeline(base, {
      mapping: source.mapping,
      rules: source.rules,
      corpus: source.corpus as unknown as GateCorpusCase[],
      ...(source.externalShape != null && typeof source.externalShape === 'object'
        ? { externalShape: source.externalShape as Record<string, unknown> }
        : {}),
      ...(source.externalMapping != null ? { externalMapping: source.externalMapping } : {}),
    })
    if (!report.ok) {
      return c.json(
        { error: 'Platform config no longer passes the gate', code: 'GATE_FAILED', report },
        422,
      )
    }

    const row = await repo.publish({
      integrationId,
      tenantId,
      visibility: 'TENANT',
      mapping: source.mapping as Prisma.InputJsonValue,
      rules: source.rules as Prisma.InputJsonValue,
      corpus: source.corpus as Prisma.InputJsonValue,
      gateReport: report as unknown as Prisma.InputJsonValue,
      publishedBy: userId,
      forkedFromConfigId: source.id,
      forkedFromVersion: source.version,
      ...(source.floor ? { floor: source.floor } : {}),
      ...(source.displayName ? { displayName: source.displayName } : {}),
      ...(source.externalShape != null
        ? { externalShape: source.externalShape as Prisma.InputJsonValue }
        : {}),
      ...(source.externalMapping != null
        ? { externalMapping: source.externalMapping as Prisma.InputJsonValue }
        : {}),
    })

    await refreshRegistryOverlay(basePrisma)
    logger.info('integration config forked', {
      integrationId,
      tenantId,
      forkedFromConfigId: source.id,
      forkedFromVersion: source.version,
      newVersion: row.version,
    })
    return c.json({ data: toFull(row) }, 201)
  },
)
