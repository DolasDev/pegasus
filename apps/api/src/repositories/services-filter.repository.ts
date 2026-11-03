// ---------------------------------------------------------------------------
// ServicesFilter repository — saved Operations → Services filters.
//
// The counterpart of availability-filter.repository.ts, with the same rules:
// ServicesFilter is in TENANT_SCOPED_MODELS, so reads/deletes are tenant-scoped
// by the Prisma extension; `create` is not rewritten, so tenantId is passed
// explicitly. A filter is visible to its owner, and to everyone in the tenant
// when isPublic. Only the owner may delete it.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'
import type { ServicesFilterQuery } from '../lib/services-filter-query'

const SELECT = {
  id: true,
  name: true,
  query: true,
  isPublic: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, email: true } },
} satisfies Prisma.ServicesFilterSelect

export type ServicesFilterRow = Prisma.ServicesFilterGetPayload<{ select: typeof SELECT }>

/** Every filter the user owns — private and public — ordered by name. */
export function listOwnedFilters(db: PrismaClient, ownerId: string) {
  return db.servicesFilter.findMany({
    where: { ownerId },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

/** Every public filter in the tenant, whoever owns it, ordered by name. */
export function listPublicFilters(db: PrismaClient) {
  return db.servicesFilter.findMany({
    where: { isPublic: true },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

/** The filter if `userId` can see it (owns it, or it is public); otherwise null. */
export function findVisibleFilter(db: PrismaClient, id: string, userId: string) {
  return db.servicesFilter.findFirst({
    where: { id, OR: [{ ownerId: userId }, { isPublic: true }] },
    select: SELECT,
  })
}

export function createFilter(
  db: PrismaClient,
  tenantId: string,
  input: { ownerId: string; name: string; query: ServicesFilterQuery; isPublic: boolean },
) {
  return db.servicesFilter.create({
    data: {
      tenantId,
      ownerId: input.ownerId,
      name: input.name,
      query: input.query,
      isPublic: input.isPublic,
    },
    select: SELECT,
  })
}

/** Deletes the filter only when `ownerId` owns it. Returns whether a row was deleted. */
export async function deleteOwnedFilter(
  db: PrismaClient,
  id: string,
  ownerId: string,
): Promise<boolean> {
  const { count } = await db.servicesFilter.deleteMany({ where: { id, ownerId } })
  return count > 0
}
