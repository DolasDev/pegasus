// ---------------------------------------------------------------------------
// IntegrationCorrelation repository
//
// Binds a Pegasus entity (localEntityType + localEntityId) to the external key
// its state is cached under in IntegrationProjection, within a tenant +
// integration + entityType. This is what makes "read the cached external state
// for shipment S" expressible: the projection is keyed by the PARTNER's
// identifier, which we otherwise only learn by fetching (Gap A).
//
// Always owned by a single tenant, so the model lives in TENANT_SCOPED_MODELS —
// every read/write below picks up the current tenant via the Prisma extension.
// `create` passes tenantId explicitly (the create path is not rewritten by the
// extension), matching the IntegrationProjection repository's precedent.
//
// BOTH directions are unique, which is the point: one local entity resolves to
// one external key and vice versa. That makes re-pointing an existing binding a
// real operation rather than a silent second row — see `upsert`.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'

export type IntegrationCorrelationRow = {
  id: string
  tenantId: string
  integrationId: string
  entityType: string
  localEntityType: string
  localEntityId: string
  entityKey: string
  updatedByUserId: string
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  integrationId: true,
  entityType: true,
  localEntityType: true,
  localEntityId: true,
  entityKey: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

export function createIntegrationCorrelationRepository(db: PrismaClient) {
  return {
    /** Our id → their key. The read the whole model exists to serve. */
    async findByLocal(
      integrationId: string,
      entityType: string,
      localEntityType: string,
      localEntityId: string,
    ): Promise<IntegrationCorrelationRow | null> {
      return db.integrationCorrelation.findFirst({
        where: { integrationId, entityType, localEntityType, localEntityId },
        select: SELECT,
      })
    },

    /** Their key → our id. The reverse lookup, for inbound attribution. */
    async findByExternal(
      integrationId: string,
      entityType: string,
      entityKey: string,
    ): Promise<IntegrationCorrelationRow | null> {
      return db.integrationCorrelation.findFirst({
        where: { integrationId, entityType, entityKey },
        select: SELECT,
      })
    },

    /**
     * Idempotent bind of one local entity to one external key.
     *
     * Because both directions are unique, three cases are distinguishable and
     * are deliberately NOT collapsed:
     *
     *  - unchanged — the same pair already exists; a no-op re-bind.
     *  - rebound   — the local entity was bound to a DIFFERENT external key.
     *                Overwritten, because the partner re-issuing its surrogate
     *                is normal and the local entity is the stable side.
     *  - conflict  — the requested external key is already bound to a DIFFERENT
     *                local entity. NOT overwritten: silently stealing the key
     *                would corrupt the other entity's cache lookup, so this
     *                returns `conflict` and lets the caller decide.
     */
    async upsert(input: {
      tenantId: string
      integrationId: string
      entityType: string
      localEntityType: string
      localEntityId: string
      entityKey: string
      updatedByUserId: string
    }): Promise<{
      row: IntegrationCorrelationRow | null
      outcome: 'created' | 'unchanged' | 'rebound' | 'conflict'
    }> {
      const [byLocal, byExternal] = await Promise.all([
        db.integrationCorrelation.findFirst({
          where: {
            integrationId: input.integrationId,
            entityType: input.entityType,
            localEntityType: input.localEntityType,
            localEntityId: input.localEntityId,
          },
          select: { id: true, entityKey: true },
        }),
        db.integrationCorrelation.findFirst({
          where: {
            integrationId: input.integrationId,
            entityType: input.entityType,
            entityKey: input.entityKey,
          },
          select: { id: true, localEntityId: true, localEntityType: true },
        }),
      ])

      // The external key already belongs to a different local entity.
      if (byExternal && byExternal.id !== byLocal?.id) {
        return { row: null, outcome: 'conflict' }
      }

      if (byLocal) {
        if (byLocal.entityKey === input.entityKey) {
          const row = await db.integrationCorrelation.findFirstOrThrow({
            where: { id: byLocal.id },
            select: SELECT,
          })
          return { row, outcome: 'unchanged' }
        }
        const row = await db.integrationCorrelation.update({
          where: { id: byLocal.id },
          data: { entityKey: input.entityKey, updatedByUserId: input.updatedByUserId },
          select: SELECT,
        })
        return { row, outcome: 'rebound' }
      }

      const data: Prisma.IntegrationCorrelationUncheckedCreateInput = {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        entityType: input.entityType,
        localEntityType: input.localEntityType,
        localEntityId: input.localEntityId,
        entityKey: input.entityKey,
        updatedByUserId: input.updatedByUserId,
      }
      const row = await db.integrationCorrelation.create({ data, select: SELECT })
      return { row, outcome: 'created' }
    },

    /**
     * Tenant-scoped hard delete by the local side. deleteMany so a missing
     * binding is a no-op (count 0), matching the projection repository.
     */
    async deleteByLocal(
      integrationId: string,
      entityType: string,
      localEntityType: string,
      localEntityId: string,
    ): Promise<number> {
      const result = await db.integrationCorrelation.deleteMany({
        where: { integrationId, entityType, localEntityType, localEntityId },
      })
      return result.count
    },
  }
}

export type IntegrationCorrelationRepository = ReturnType<
  typeof createIntegrationCorrelationRepository
>
