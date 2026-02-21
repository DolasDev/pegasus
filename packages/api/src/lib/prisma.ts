// ---------------------------------------------------------------------------
// Tenant-scoped Prisma Client Extension
//
// Call createTenantDb(basePrisma, tenantId) to get a Prisma client whose
// every read/write is automatically filtered (or stamped) with the given
// tenantId. Developers using this client never need to pass tenantId
// explicitly — the extension handles it transparently.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client'

/**
 * The set of Prisma model names that carry a tenantId column.
 * Junction tables (MoveCrewAssignment, MoveVehicleAssignment) and purely
 * child models (Contact, Stop, QuoteLineItem, InventoryItem, Payment, Rate)
 * are intentionally excluded because they inherit tenant scope through their
 * parent relation.
 */
const TENANT_SCOPED_MODELS = new Set([
  'Customer',
  'Move',
  'Quote',
  'Invoice',
  'CrewMember',
  'Vehicle',
  'Availability',
  'InventoryRoom',
  'LeadSource',
  'Account',
  'RateTable',
])

/**
 * Creates a tenant-scoped Prisma client by wrapping basePrisma with a query
 * extension that automatically scopes every read/write to the given tenantId:
 *
 * - findMany / findFirst / findUnique / count → filters WHERE by tenantId
 * - update / updateMany  → scopes WHERE to tenantId
 * - delete / deleteMany  → scopes WHERE to tenantId
 *
 * Create operations are NOT modified here — repository functions pass tenantId
 * explicitly in their create data, which avoids conflicts between the
 * MoveCreateInput (relation-based) and MoveUncheckedCreateInput (scalar-based)
 * Prisma union constraints.
 *
 * Models not in TENANT_SCOPED_MODELS are passed through untouched.
 */
export function createTenantDb(basePrisma: PrismaClient, tenantId: string) {
  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string
          operation: string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: Record<string, any>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: Record<string, any>) => Promise<any>
        }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args)
          }

          if (
            operation === 'findMany' ||
            operation === 'findFirst' ||
            operation === 'findFirstOrThrow' ||
            operation === 'findUnique' ||
            operation === 'findUniqueOrThrow' ||
            operation === 'update' ||
            operation === 'updateMany' ||
            operation === 'delete' ||
            operation === 'deleteMany' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy'
          ) {
            args['where'] = { ...args['where'], tenantId }
          }

          return query(args)
        },
      },
    },
  })
}

/** The type of the tenant-scoped Prisma client returned by createTenantDb. */
export type TenantDb = ReturnType<typeof createTenantDb>
