// ---------------------------------------------------------------------------
// Tenant Temporal-namespace cutover (Phase 3b.2) — the drain half.
//
// An admin starts a cutover (READY → DRAINING) or a rollback
// (ACTIVE → REVERTING) from admin-web. While a tenant is in either state its
// new tenant-runner starts are refused (409 TENANT_MIGRATING) and its EVENT
// outbox rows wait undispatched. This module finishes each drain: once the
// tenant has no open tenant-runner executions left in the namespace it is
// leaving, the row moves on —
//
//   DRAINING  → ACTIVE  when nothing is open in the SHARED namespace
//   REVERTING → READY   when nothing is open in the TENANT namespace
//
// Called once per trigger-dispatcher tick (every minute, cross-tenant), before
// the event phase so a tenant that settles this tick has its waiting events
// dispatched in the same tick.
//
// What counts as "open" (all of these must hold):
//   * a tenant-runner execution: executable and not a curated name. Curated
//     (STDLIB) runs always live in the platform namespace and are never
//     refused, so counting them could hold a busy tenant in DRAINING forever.
//   * in the namespace being left (the row's recorded temporalNamespace).
//   * RUNNING — the reconciler closes RUNNING rows Temporal has finished — or
//     QUEUED and younger than STALE_QUEUED_MS. A QUEUED row older than that is
//     an orphan (the start path deliberately leaves the row of a raced
//     REJECT_DUPLICATE start QUEUED forever), not work in flight; counting it
//     would wedge the drain.
//
// Legacy-runner retirement: where tenant namespaces are provisioned (staging,
// prod) there is no shared runner, so a READY row is only a waypoint. Each
// pass also
//
//   READY        → DRAINING  (then on to ACTIVE in the SAME pass) once the
//                            tenant's current key still passes the readiness
//                            check: the automatic version of the admin's
//                            Cut over, with nobody to press it
//   PROVISIONING (lease expired) → re-invoke the provisioner (a killed run;
//                            nothing else would resume it: the tenant's
//                            events are held and its starts refused)
//   FAILED (untouched 15 min)    → retry the provision
//
// and reports how many rows look unhealthy (TenantTemporalNamespacesUnhealthy).
//
// A start that read READY just before the flip to DRAINING can still insert a
// shared-namespace row after this count reached zero. That's safe: the row
// recorded its namespace, so the runner sweep (lib/tenant-runner.ts) still
// launches a legacy runner for it, and ACTIVE never stops a shared row from
// finishing.
// ---------------------------------------------------------------------------

import type { PrismaClient, TenantTemporalNamespaceStatus } from '@prisma/client'
import {
  createTenantTemporalNamespaceRepository,
  MIGRATING_STATUSES,
  type TenantTemporalNamespaceRow,
} from '../repositories/tenant-temporal-namespace.repository'
import { CURATED_WORKFLOW_NAMES } from './curated-workflows'
import { keyAuthorizedOnNamespace } from './temporal-namespace-readiness'
import { requestTenantNamespace, tenantNamespacesConfigured } from './tenant-namespace-request'
import { logger } from './logger'

/** A FAILED row untouched this long is retried by the next pass. */
export const FAILED_RETRY_AFTER_MS = 15 * 60 * 1000

/**
 * A READY or PROVISIONING row untouched this long counts as unhealthy: a key
 * that stopped authorizing (READY never advances) or a provisioner that keeps
 * dying. A healthy provision updates its row at every step and finishes in
 * well under 15 minutes (the Lambda timeout).
 */
export const STUCK_AFTER_MS = 20 * 60 * 1000

export type AdvanceNamespaceMigrationsDeps = {
  /** Default: tenantNamespacesConfigured(). False = 3b.2 behavior (drains only). */
  configured?: boolean
  /** Whether the tenant's current key still passes the readiness check. */
  keyAuthorized?: (db: PrismaClient, tenantId: string) => Promise<boolean>
  /** Default: requestTenantNamespace. */
  request?: typeof requestTenantNamespace
}

async function currentKeyAuthorized(db: PrismaClient, tenantId: string): Promise<boolean> {
  const key = await createTenantTemporalNamespaceRepository(db).getDecryptedKey(tenantId)
  return key !== null && (await keyAuthorizedOnNamespace(key))
}

/**
 * A QUEUED row older than this is an orphan, not work in flight: a real start
 * moves its row to RUNNING (or FAILED) within seconds, and tenant-runner
 * executions are capped at 15 minutes.
 */
export const STALE_QUEUED_MS = 30 * 60 * 1000

export type NamespaceMigrationStep = {
  tenantId: string
  from: TenantTemporalNamespaceStatus
  to: TenantTemporalNamespaceStatus
}

export type AdvanceNamespaceMigrationsResult = {
  /** Rows still draining after this pass, with their open-execution counts. */
  waiting: Array<{ tenantId: string; status: TenantTemporalNamespaceStatus; open: number }>
  /** Rows that moved on this pass. */
  advanced: NamespaceMigrationStep[]
  /** Tenants whose provision was (re)requested this pass. */
  retried: string[]
  /** FAILED rows, plus READY/PROVISIONING rows untouched for STUCK_AFTER_MS. */
  unhealthy: number
}

/**
 * Open tenant-runner executions of `tenantId` in `namespace` (null = the
 * shared namespace). See the module header for what counts as open.
 */
export async function countOpenTenantRunnerExecutions(
  db: PrismaClient,
  tenantId: string,
  namespace: string | null,
  now: Date = new Date(),
): Promise<number> {
  return db.workflowExecution.count({
    where: {
      tenantId,
      temporalNamespace: namespace,
      workflow: { executable: true, name: { notIn: [...CURATED_WORKFLOW_NAMES] } },
      OR: [
        { status: 'RUNNING' },
        { status: 'QUEUED', queuedAt: { gt: new Date(now.getTime() - STALE_QUEUED_MS) } },
      ],
    },
  })
}

/**
 * One pass over every row that needs moving (see the module header), or only
 * `opts.tenantIds`' rows: tests share one database. Each row is isolated: a
 * failure on one is logged and leaves it for the next tick.
 */
export async function advanceNamespaceMigrations(
  db: PrismaClient,
  now: Date = new Date(),
  opts: { tenantIds?: string[] } & AdvanceNamespaceMigrationsDeps = {},
): Promise<AdvanceNamespaceMigrationsResult> {
  const repo = createTenantTemporalNamespaceRepository(db)
  const configured = opts.configured ?? tenantNamespacesConfigured()
  const keyAuthorized = opts.keyAuthorized ?? currentKeyAuthorized
  const request = opts.request ?? requestTenantNamespace
  const result: AdvanceNamespaceMigrationsResult = {
    waiting: [],
    advanced: [],
    retried: [],
    unhealthy: 0,
  }

  const statuses: TenantTemporalNamespaceStatus[] = configured
    ? [...MIGRATING_STATUSES, 'READY', 'PROVISIONING', 'FAILED']
    : [...MIGRATING_STATUSES]
  for (const found of await repo.findInStatuses(statuses, opts.tenantIds)) {
    try {
      let row: TenantTemporalNamespaceRow = found
      // Only for the provisioning-side statuses: a drain never reads it.
      const untouched = () => now.getTime() - row.updatedAt.getTime()

      if (row.status === 'FAILED') {
        result.unhealthy += 1
        if (untouched() >= FAILED_RETRY_AFTER_MS) await retry(row)
        continue
      }
      if (row.status === 'PROVISIONING') {
        if (untouched() >= STUCK_AFTER_MS) result.unhealthy += 1
        // A run holding the lease is on it; an expired lease means it was killed.
        if (row.leaseExpiresAt === null || row.leaseExpiresAt <= now) await retry(row)
        continue
      }
      if (row.status === 'READY') {
        if (!(await keyAuthorized(db, row.tenantId))) {
          if (untouched() >= STUCK_AFTER_MS) result.unhealthy += 1
          logger.warn('temporal_namespace.auto_cutover_key_not_ready', {
            tenantId: row.tenantId,
            namespace: row.namespace,
          })
          continue
        }
        if (!(await repo.transition(row.tenantId, ['READY'], 'DRAINING'))) continue
        result.advanced.push({ tenantId: row.tenantId, from: 'READY', to: 'DRAINING' })
        logger.info('temporal_namespace.migration_advanced', {
          audit: true,
          tenantId: row.tenantId,
          namespace: row.namespace,
          from: 'READY',
          to: 'DRAINING',
          automatic: true,
        })
        row = { ...row, status: 'DRAINING' }
      }

      // DRAINING leaves the shared namespace; REVERTING leaves the tenant's.
      const leaving = row.status === 'DRAINING' ? null : row.namespace
      const to: TenantTemporalNamespaceStatus = row.status === 'DRAINING' ? 'ACTIVE' : 'READY'
      const open = await countOpenTenantRunnerExecutions(db, row.tenantId, leaving, now)
      if (open > 0) {
        result.waiting.push({ tenantId: row.tenantId, status: row.status, open })
        continue
      }
      // Compare-and-set: an admin action that changed the row meanwhile wins.
      if (await repo.transition(row.tenantId, [row.status], to)) {
        result.advanced.push({ tenantId: row.tenantId, from: row.status, to })
        logger.info('temporal_namespace.migration_advanced', {
          audit: true,
          tenantId: row.tenantId,
          namespace: row.namespace,
          from: row.status,
          to,
        })
      }
    } catch (err) {
      logger.error('temporal_namespace.migration_advance_failed', {
        tenantId: found.tenantId,
        status: found.status,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result

  async function retry(row: TenantTemporalNamespaceRow): Promise<void> {
    const requested = await request(db, row.tenantId, { cause: 'retry', now })
    if (requested.outcome === 'REQUESTED' || requested.outcome === 'INVOKE_FAILED') {
      result.retried.push(row.tenantId)
    }
  }
}
