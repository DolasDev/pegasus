// ---------------------------------------------------------------------------
// Tenant-scoped Prisma Client Extension
//
// Call createTenantDb(basePrisma, tenantId) to get a Prisma client whose
// every read/write is automatically filtered (or stamped) with the given
// tenantId. Developers using this client never need to pass tenantId
// explicitly — the extension handles it transparently.
// ---------------------------------------------------------------------------

import { type PrismaClient } from '@prisma/client'
import { recordDownstream } from './request-timing'

/**
 * The set of Prisma model names that carry a tenantId column.
 * Junction tables (MoveCrewAssignment, MoveVehicleAssignment) and purely
 * child models (Contact, Stop, QuoteLineItem, InventoryItem, Payment, Rate)
 * are intentionally excluded because they inherit tenant scope through their
 * parent relation.
 */
export const TENANT_SCOPED_MODELS = new Set([
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
  'TenantSsoProvider',
  'PegasusEvent',
  'Document',
  // WorkflowExecution is always tenant-owned (no GLOBAL case), so it is
  // auto-scoped here. Contrast with Workflow below.
  'WorkflowExecution',
  // WorkflowTrigger is always tenant-owned, same as WorkflowExecution — a
  // tenant's trigger on a GLOBAL workflow is still the tenant's own row. The
  // future Unit 3 dispatcher Lambda matches cross-tenant via the root `db`,
  // which bypasses this extension.
  'WorkflowTrigger',
  // DomainEvent (outbox) rows are written by emitDomainEvent via the
  // tenant-scoped client inside handler transactions. The future trigger
  // dispatcher Lambda reads cross-tenant via the root `db`, which bypasses
  // this extension — same precedent as the WorkflowExecution reconcile poller.
  'DomainEvent',
  // Messaging — tenant-owned entities a tenant/admin handler reads via the
  // scoped client. The background capture/forward/purge jobs use the base
  // client (cross-tenant cron context) and are unaffected by this set.
  'RingCentralConnection',
  'Message',
  // Push notifications — DeviceToken rows are read/written by the tenant-scoped
  // device-token handler; PushNotificationOutbox rows are enqueued by handlers
  // and domain-event emitters via the scoped client inside transactions. The
  // background push-forward Lambda reads cross-tenant via the base client, which
  // bypasses this extension — same precedent as the messaging forward job.
  'DeviceToken',
  'PushNotificationOutbox',
  // ArchivedTrip (rejected/cancelled longhaul trip snapshots). The longhaul
  // cloud handlers read/write via the base client and pass tenantId explicitly
  // (the longhaul convention — same as trip-detail/trips-list), so the manual
  // scoping is what enforces isolation today. Listed here so any future access
  // via the tenant-scoped client is auto-scoped too. ArchivedTripDriver has no
  // tenantId (it links via archivedTripId) and is isolated transitively.
  'ArchivedTrip',
  // Workflow is intentionally NOT scoped here — the GLOBAL visibility case
  // requires reading rows owned by a different tenant (the platform tenant).
  // The extension's top-level `tenantId = current` merge would neutralise the
  // `OR: [{tenantId}, {visibility: 'GLOBAL'}]` predicate in the repository.
  // Workflow is in INTENTIONALLY_UNSCOPED in prisma-tenant-isolation.test.ts.
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
            return recordDownstream('db', () => query(args))
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

          return recordDownstream('db', () => query(args))
        },
      },
    },
  })
}

/** The type of the tenant-scoped Prisma client returned by createTenantDb. */
export type TenantDb = ReturnType<typeof createTenantDb>
