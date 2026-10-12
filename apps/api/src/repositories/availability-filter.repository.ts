// ---------------------------------------------------------------------------
// AvailabilityFilter repository — saved Operations → Availability filters.
//
// AvailabilityFilter is in TENANT_SCOPED_MODELS, so reads/updates/deletes are
// tenant-scoped by the Prisma extension; `create` is not rewritten by the
// extension, so tenantId is passed explicitly (repo convention).
//
// Visibility rule: a filter is visible to its owner, and to everyone in the
// tenant when isPublic. Only the owner may delete it.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'
import type { AvailabilityFilterQuery } from '../lib/availability-filter-query'

const SELECT = {
  id: true,
  name: true,
  query: true,
  isPublic: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, email: true } },
} satisfies Prisma.AvailabilityFilterSelect

export type AvailabilityFilterRow = Prisma.AvailabilityFilterGetPayload<{ select: typeof SELECT }>

/** Every filter the user owns — private and public — ordered by name. */
export function listOwnedFilters(db: PrismaClient, ownerId: string) {
  return db.availabilityFilter.findMany({
    where: { ownerId },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

/** Every public filter in the tenant, whoever owns it, ordered by name. */
export function listPublicFilters(db: PrismaClient) {
  return db.availabilityFilter.findMany({
    where: { isPublic: true },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

/** The filter if `userId` can see it (owns it, or it is public); otherwise null. */
export function findVisibleFilter(db: PrismaClient, id: string, userId: string) {
  return db.availabilityFilter.findFirst({
    where: { id, OR: [{ ownerId: userId }, { isPublic: true }] },
    select: SELECT,
  })
}

export function createFilter(
  db: PrismaClient,
  tenantId: string,
  input: { ownerId: string; name: string; query: AvailabilityFilterQuery; isPublic: boolean },
) {
  return db.availabilityFilter.create({
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
  const { count } = await db.availabilityFilter.deleteMany({ where: { id, ownerId } })
  return count > 0
}
