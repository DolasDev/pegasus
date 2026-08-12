// ---------------------------------------------------------------------------
// DashboardDefinition repository.
//
// Publishing is append-only: a publish writes a new immutable
// (tenantId, slug, version) row and supersedes the prior PUBLISHED row of that
// lineage in one transaction. Visibility is derived server-side from the
// publishing tenant's isPlatformTenant flag (GLOBAL for the platform tenant,
// TENANT otherwise) — exactly like IntegrationConfig.
//
// SECURITY: DashboardDefinition is intentionally NOT in TENANT_SCOPED_MODELS.
// The GLOBAL fallback read has to cross the tenant boundary on purpose, so the
// Prisma extension cannot help here and EVERY query below carries its own
// explicit tenantId/visibility predicate. A missing predicate leaks another
// tenant's dashboards — see the cross-tenant isolation test.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

export type DashboardVisibility = 'GLOBAL' | 'TENANT'
export type DashboardStatus = 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED'

export interface DashboardRow {
  id: string
  tenantId: string
  slug: string
  version: number
  visibility: DashboardVisibility
  status: DashboardStatus
  title: string
  description: string | null
  definition: Prisma.JsonValue
  publishedBy: string
  forkedFromDefinitionId: string | null
  forkedFromVersion: number | null
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  slug: true,
  version: true,
  visibility: true,
  status: true,
  title: true,
  description: true,
  definition: true,
  publishedBy: true,
  forkedFromDefinitionId: true,
  forkedFromVersion: true,
  createdAt: true,
  updatedAt: true,
} as const

export interface PublishInput {
  tenantId: string
  slug: string
  visibility: DashboardVisibility
  title: string
  description?: string | undefined
  definition: Prisma.InputJsonValue
  publishedBy: string
  forkedFromDefinitionId?: string | undefined
  forkedFromVersion?: number | undefined
}

export function createDashboardDefinitionRepository(db: PrismaClient) {
  return {
    /**
     * Publish a new immutable version for (tenantId, slug).
     *
     * The supersede + insert run in ONE transaction: a crash between them would
     * otherwise leave a lineage with either two PUBLISHED rows (ambiguous
     * resolution) or none (the dashboard vanishes from every user's picker).
     */
    async publish(input: PublishInput): Promise<DashboardRow> {
      return db.$transaction(async (tx) => {
        const latest = await tx.dashboardDefinition.findFirst({
          where: { tenantId: input.tenantId, slug: input.slug },
          orderBy: { version: 'desc' },
          select: { version: true },
        })

        await tx.dashboardDefinition.updateMany({
          where: { tenantId: input.tenantId, slug: input.slug, status: 'PUBLISHED' },
          data: { status: 'SUPERSEDED' },
        })

        return tx.dashboardDefinition.create({
          data: {
            tenantId: input.tenantId,
            slug: input.slug,
            version: (latest?.version ?? 0) + 1,
            visibility: input.visibility,
            status: 'PUBLISHED',
            title: input.title,
            description: input.description ?? null,
            definition: input.definition,
            publishedBy: input.publishedBy,
            forkedFromDefinitionId: input.forkedFromDefinitionId ?? null,
            forkedFromVersion: input.forkedFromVersion ?? null,
          },
          select: SELECT,
        }) as unknown as Promise<DashboardRow>
      })
    },

    /**
     * Every dashboard this tenant can see: its OWN published rows plus the
     * platform's GLOBAL ones. A tenant row SHADOWS a GLOBAL row of the same
     * slug (the tenant forked and customized it), so at most one row per slug
     * comes back.
     */
    async listVisible(tenantId: string): Promise<DashboardRow[]> {
      const rows = (await db.dashboardDefinition.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [{ tenantId }, { visibility: 'GLOBAL' }],
        },
        orderBy: [{ title: 'asc' }, { version: 'desc' }],
        select: SELECT,
      })) as unknown as DashboardRow[]

      const bySlug = new Map<string, DashboardRow>()
      for (const row of rows) {
        const existing = bySlug.get(row.slug)
        // Prefer the tenant's own row; otherwise keep the first (GLOBAL) one.
        if (!existing || (existing.tenantId !== tenantId && row.tenantId === tenantId)) {
          bySlug.set(row.slug, row)
        }
      }
      return [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title))
    },

    /**
     * Resolve one slug for a tenant: their own PUBLISHED row wins, else the
     * GLOBAL one, else null. This is what a user's `defaultDashboardSlug`
     * resolves through.
     */
    async resolveBySlug(slug: string, tenantId: string): Promise<DashboardRow | null> {
      const own = await db.dashboardDefinition.findFirst({
        where: { slug, tenantId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      if (own) return own as unknown as DashboardRow

      const global = await db.dashboardDefinition.findFirst({
        where: { slug, visibility: 'GLOBAL', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      return (global as unknown as DashboardRow) ?? null
    },

    /**
     * The GLOBAL row for a slug — the fork source. Null when the platform has
     * published nothing under that slug.
     */
    async findGlobal(slug: string): Promise<DashboardRow | null> {
      const row = await db.dashboardDefinition.findFirst({
        where: { slug, visibility: 'GLOBAL', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      return (row as unknown as DashboardRow) ?? null
    },

    /** The tenant's OWN published row for a slug, ignoring any GLOBAL fallback. */
    async findOwn(slug: string, tenantId: string): Promise<DashboardRow | null> {
      const row = await db.dashboardDefinition.findFirst({
        where: { slug, tenantId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      return (row as unknown as DashboardRow) ?? null
    },

    /**
     * Archive a tenant's entire lineage for a slug. Scoped to the caller's
     * tenant, so it can never withdraw a GLOBAL dashboard or another tenant's.
     * A tenant archiving its fork falls back to the GLOBAL original on the next
     * resolve, which is the intended behavior.
     */
    async archive(slug: string, tenantId: string): Promise<number> {
      const { count } = await db.dashboardDefinition.updateMany({
        where: { slug, tenantId, status: { in: ['PUBLISHED', 'SUPERSEDED'] } },
        data: { status: 'ARCHIVED' },
      })
      return count
    },
  }
}

export type DashboardDefinitionRepository = ReturnType<typeof createDashboardDefinitionRepository>
