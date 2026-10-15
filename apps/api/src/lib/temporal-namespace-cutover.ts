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
// A start that read READY just before the flip to DRAINING can still insert a
// shared-namespace row after this count reached zero. That's safe: the row
// recorded its namespace, so the runner sweep (lib/tenant-runner.ts) still
// launches a legacy runner for it, and ACTIVE never stops a shared row from
// finishing.
// ---------------------------------------------------------------------------

import type { PrismaClient, TenantTemporalNamespaceStatus } from '@prisma/client'
import { createTenantTemporalNamespaceRepository } from '../repositories/tenant-temporal-namespace.repository'
import { CURATED_WORKFLOW_NAMES } from './curated-workflows'
import { logger } from './logger'

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
 * One pass over every DRAINING / REVERTING row (or only `opts.tenantIds`'
 * rows: tests share one database). Each row is isolated: a failure on one is
 * logged and leaves it for the next tick.
 */
export async function advanceNamespaceMigrations(
  db: PrismaClient,
  now: Date = new Date(),
  opts: { tenantIds?: string[] } = {},
): Promise<AdvanceNamespaceMigrationsResult> {
  const repo = createTenantTemporalNamespaceRepository(db)
  const result: AdvanceNamespaceMigrationsResult = { waiting: [], advanced: [] }

  for (const row of await repo.findMigrating(opts.tenantIds)) {
    try {
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
        tenantId: row.tenantId,
        status: row.status,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}
