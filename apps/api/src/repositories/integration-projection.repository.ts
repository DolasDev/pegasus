// ---------------------------------------------------------------------------
// IntegrationProjection repository
//
// Per-record cache of an external system's last-known state, keyed by
// (integrationId, entityType, entityKey) within a tenant. A running workflow
// maintains it via the SDK; the integration validator reads `state` back as the
// `prior` input for transition rules.
//
// Always owned by a single tenant, so the model lives in TENANT_SCOPED_MODELS —
// every read/write below picks up the current tenant via the Prisma extension.
// `create` passes tenantId explicitly (the create path is not rewritten by the
// extension). Durable, last-write-wins; `version` is a monotonic write counter.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'

export type IntegrationProjectionRow = {
  id: string
  tenantId: string
  integrationId: string
  entityType: string
  entityKey: string
  state: Prisma.JsonValue
  version: number
  updatedByUserId: string
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  integrationId: true,
  entityType: true,
  entityKey: true,
  state: true,
  version: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

export function createIntegrationProjectionRepository(db: PrismaClient) {
  return {
    /** Tenant-scoped fetch by the full natural key. */
    async findByKey(
      integrationId: string,
      entityType: string,
      entityKey: string,
    ): Promise<IntegrationProjectionRow | null> {
      return db.integrationProjection.findFirst({
        where: { integrationId, entityType, entityKey },
        select: SELECT,
      })
    },

    /**
     * Tenant-scoped read of just the cached `state` for the validator's
     * prior-state lookup. Returns null when no row exists.
     */
    async findState(
      integrationId: string,
      entityType: string,
      entityKey: string,
    ): Promise<Prisma.JsonValue | null> {
      const row = await db.integrationProjection.findFirst({
        where: { integrationId, entityType, entityKey },
        select: { state: true },
      })
      return row?.state ?? null
    },

    /**
     * Tenant-scoped list of records for one (integrationId, entityType).
     *
     * With no `opts` this is the original unpaged, unfiltered list (the runtime
     * caller). `opts` adds a read-model query surface (sdk-feedback/0026 Part 2b):
     *   - `status` — equality filter on the projection state's top-level `status`
     *     (a workflow that wants status-filterable records writes a top-level
     *     `status` into the canonical entity it persists);
     *   - `updatedSince` — only records changed at/after this instant (the indexed
     *     `updatedAt` column — "changed since T" without listing the whole type);
     *   - `limit` / `cursor` — keyset paging over `entityKey` (ascending; `cursor`
     *     is the last `entityKey` of the previous page, exclusive).
     */
    async list(
      integrationId: string,
      entityType: string,
      opts: { status?: string; updatedSince?: Date; limit?: number; cursor?: string } = {},
    ): Promise<IntegrationProjectionRow[]> {
      const where: Prisma.IntegrationProjectionWhereInput = { integrationId, entityType }
      if (opts.updatedSince) where.updatedAt = { gte: opts.updatedSince }
      if (opts.status !== undefined) where.state = { path: ['status'], equals: opts.status }
      if (opts.cursor) where.entityKey = { gt: opts.cursor }
      return db.integrationProjection.findMany({
        where,
        orderBy: { entityKey: 'asc' },
        ...(opts.limit !== undefined ? { take: opts.limit } : {}),
        select: SELECT,
      })
    },

    /**
     * Upsert the cached state for one record. Find-then-create/update (rather
     * than Prisma native upsert) so the tenant extension scoping matches the
     * existing repository precedent. `version` starts at 1 and is bumped on each
     * overwrite. The caller passes tenantId/userId explicitly for the create.
     */
    async upsert(input: {
      tenantId: string
      integrationId: string
      entityType: string
      entityKey: string
      state: Prisma.InputJsonValue
      updatedByUserId: string
    }): Promise<{ row: IntegrationProjectionRow; created: boolean }> {
      const existing = await db.integrationProjection.findFirst({
        where: {
          integrationId: input.integrationId,
          entityType: input.entityType,
          entityKey: input.entityKey,
        },
        select: { id: true, version: true },
      })

      if (existing) {
        const row = await db.integrationProjection.update({
          where: { id: existing.id },
          data: {
            state: input.state,
            version: existing.version + 1,
            updatedByUserId: input.updatedByUserId,
          },
          select: SELECT,
        })
        return { row, created: false }
      }

      const data: Prisma.IntegrationProjectionUncheckedCreateInput = {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        entityType: input.entityType,
        entityKey: input.entityKey,
        state: input.state,
        updatedByUserId: input.updatedByUserId,
      }
      const row = await db.integrationProjection.create({ data, select: SELECT })
      return { row, created: true }
    },

    /**
     * Tenant-scoped hard delete by the natural key. Uses deleteMany so a missing
     * key is a no-op (returns count 0) — the handler maps count 0 to 404.
     */
    async deleteByKey(
      integrationId: string,
      entityType: string,
      entityKey: string,
    ): Promise<number> {
      const result = await db.integrationProjection.deleteMany({
        where: { integrationId, entityType, entityKey },
      })
      return result.count
    },
  }
}

export type IntegrationProjectionRepository = ReturnType<
  typeof createIntegrationProjectionRepository
>
