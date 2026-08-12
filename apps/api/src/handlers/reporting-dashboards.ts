// ---------------------------------------------------------------------------
// Dashboard CRUD — the phase-2 authoring surface.
//
//   GET    /reporting/dashboards        -- everything this tenant can see
//   GET    /reporting/dashboards/:slug  -- one, resolved own-then-GLOBAL
//   POST   /reporting/dashboards        -- publish a new immutable version
//   POST   /reporting/dashboards/:slug/fork -- copy a GLOBAL one to this tenant
//   DELETE /reporting/dashboards/:slug  -- archive this tenant's lineage
//
// Reads are gated by ReadReportingDataset (same as the catalog); writes by
// ManageDashboards, which in this phase only tenant_admin holds.
//
// Visibility is derived SERVER-SIDE from the publishing tenant's
// isPlatformTenant flag — a client cannot ask for GLOBAL. Same rule as
// IntegrationConfig, and the reason a tenant cannot publish something every
// other tenant would see.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { requirePermission } from '../middleware/rbac'
import { listAllowedPermissions } from '../lib/authz'
import { logger } from '../lib/logger'
import { createDashboardDefinitionRepository } from '../repositories/dashboard-definition.repository'
import type { DashboardRow } from '../repositories/dashboard-definition.repository'
import { parseDefinition } from '../reporting/definition'
import { isValidSlug, validateDefinition } from '../reporting/definition-validation'

export const reportingDashboardsHandler = new Hono<AppEnv>()

// No feature gate here: this router is mounted INSIDE reportingHandler (see
// handlers/reporting.ts), whose `use('*')` REPORTING_ENABLED gate therefore
// already covers every route below. Adding a second one would be dead code that
// reads as though it were load-bearing.

async function permissionSet(c: Context<AppEnv>): Promise<Set<string>> {
  const principal = c.get('principal')
  if (!principal) return new Set<string>()
  return new Set(await listAllowedPermissions(principal, c.get('idToken'), c.get('policyStoreId')))
}

/**
 * Hono types a path param as `string | undefined` under strict mode. The route
 * cannot match without it, so this narrows rather than handles a real case.
 */
function slugParam(c: Context<AppEnv>): string {
  return c.req.param('slug') ?? ''
}

/**
 * Who published. `publishedBy` is denormalized provenance, not an FK, so an M2M
 * principal with no TenantUser row records the sentinel rather than failing the
 * publish — losing attribution is strictly better than losing the dashboard.
 */
function publisherId(c: Context<AppEnv>): string {
  return c.get('userId') ?? 'unknown'
}

/** Wire shape — never leaks tenantId or the raw row. */
function toDto(row: DashboardRow, tenantId: string) {
  return {
    slug: row.slug,
    version: row.version,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    definition: row.definition,
    updatedAt: row.updatedAt.toISOString(),
    /** True when this row belongs to the caller's tenant (vs a GLOBAL one). */
    owned: row.tenantId === tenantId,
    /** A GLOBAL row the tenant has not forked yet can be forked. */
    forkable: row.visibility === 'GLOBAL' && row.tenantId !== tenantId,
    forkedFrom: row.forkedFromDefinitionId
      ? { definitionId: row.forkedFromDefinitionId, version: row.forkedFromVersion }
      : null,
  }
}

const PublishBody = z.object({
  slug: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  definition: z.unknown(),
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

reportingDashboardsHandler.get('/', requirePermission(Actions.ReadReportingDataset), async (c) => {
  const tenantId = c.get('tenantId')
  const repo = createDashboardDefinitionRepository(c.get('db'))
  const rows = await repo.listVisible(tenantId)
  return c.json({ data: { dashboards: rows.map((r) => toDto(r, tenantId)) } })
})

reportingDashboardsHandler.get(
  '/:slug',
  requirePermission(Actions.ReadReportingDataset),
  async (c) => {
    const tenantId = c.get('tenantId')
    const slug = slugParam(c)
    const repo = createDashboardDefinitionRepository(c.get('db'))
    const row = await repo.resolveBySlug(slug, tenantId)
    if (!row) {
      return c.json({ error: `No dashboard "${slug}"`, code: 'NOT_FOUND' }, 404)
    }
    return c.json({ data: toDto(row, tenantId) })
  },
)

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

reportingDashboardsHandler.post('/', requirePermission(Actions.ManageDashboards), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_BODY' }, 400)
  }

  const parsed = PublishBody.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', code: 'INVALID_BODY', details: parsed.error.issues },
      400,
    )
  }
  if (!isValidSlug(parsed.data.slug)) {
    return c.json({ error: 'slug must be lowercase kebab-case', code: 'INVALID_SLUG' }, 400)
  }

  // Parse the document (upgrading a v1 body if a client sends one)...
  let doc
  try {
    doc = parseDefinition(parsed.data.definition)
  } catch (err) {
    return c.json(
      {
        error: 'Invalid dashboard definition',
        code: 'INVALID_DEFINITION',
        details: err instanceof z.ZodError ? err.issues : undefined,
      },
      400,
    )
  }

  // ...then check it against the registry and the caller's own grants.
  const verdict = validateDefinition(doc, await permissionSet(c))
  if (!verdict.ok) {
    return c.json({ error: verdict.error, code: verdict.code }, verdict.status)
  }

  const tenantId = c.get('tenantId')
  const db = c.get('db')
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { isPlatformTenant: true },
  })

  const repo = createDashboardDefinitionRepository(db)
  const row = await repo.publish({
    tenantId,
    slug: parsed.data.slug,
    // Derived server-side — a client cannot ask to publish GLOBAL.
    visibility: tenant?.isPlatformTenant ? 'GLOBAL' : 'TENANT',
    title: parsed.data.title,
    description: parsed.data.description,
    definition: doc as unknown as Prisma.InputJsonValue,
    publishedBy: publisherId(c),
  })

  logger.info('dashboard published', {
    tenantId,
    slug: row.slug,
    version: row.version,
    driftWarnings: verdict.warnings.length,
  })

  return c.json({ data: { ...toDto(row, tenantId), warnings: verdict.warnings } }, 201)
})

reportingDashboardsHandler.post(
  '/:slug/fork',
  requirePermission(Actions.ManageDashboards),
  async (c) => {
    const tenantId = c.get('tenantId')
    const slug = slugParam(c)
    const db = c.get('db')
    const repo = createDashboardDefinitionRepository(db)

    const source = await repo.findGlobal(slug)
    if (!source) {
      return c.json({ error: `No GLOBAL dashboard "${slug}" to fork`, code: 'NOT_FOUND' }, 404)
    }

    // Forking is idempotent-ish: a tenant that already owns this slug is told
    // so rather than silently getting a second lineage.
    const existing = await repo.findOwn(slug, tenantId)
    if (existing) {
      return c.json(
        { error: `This tenant already has a dashboard "${slug}"`, code: 'ALREADY_FORKED' },
        409,
      )
    }

    const row = await repo.publish({
      tenantId,
      slug,
      visibility: 'TENANT',
      title: source.title,
      description: source.description ?? undefined,
      definition: source.definition as Prisma.InputJsonValue,
      publishedBy: publisherId(c),
      forkedFromDefinitionId: source.id,
      forkedFromVersion: source.version,
    })

    logger.info('dashboard forked', { tenantId, slug, fromVersion: source.version })
    return c.json({ data: toDto(row, tenantId) }, 201)
  },
)

reportingDashboardsHandler.delete(
  '/:slug',
  requirePermission(Actions.ManageDashboards),
  async (c) => {
    const tenantId = c.get('tenantId')
    const slug = slugParam(c)
    const repo = createDashboardDefinitionRepository(c.get('db'))

    // Scoped to the caller's tenant, so this can never withdraw a GLOBAL
    // dashboard or another tenant's. Archiving a fork falls back to the GLOBAL
    // original on the next resolve, which is the intended behavior.
    const count = await repo.archive(slug, tenantId)
    if (count === 0) {
      return c.json(
        { error: `No dashboard "${slug}" owned by this tenant`, code: 'NOT_FOUND' },
        404,
      )
    }

    logger.info('dashboard archived', { tenantId, slug, versions: count })
    return c.json({ data: { slug, archivedVersions: count } })
  },
)
