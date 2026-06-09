// ---------------------------------------------------------------------------
// Scheduled Lambda — reconciles orphaned RUNNING workflow executions.
//
// The crash-recovery backstop for the Phase 2 execution runtime. The happy
// path is: the API inserts a QUEUED row, transitions it to RUNNING after
// `start_workflow` on Temporal Cloud, and the Fargate worker writes the
// terminal transition back via PATCH /api/v1/internal/workflow-executions/:id.
//
// If the worker crashes mid-execution it never writes back, leaving a stale
// RUNNING row in the DB forever. This Lambda runs every minute, finds RUNNING
// rows older than a grace window, asks Temporal Cloud for their true state,
// and flips the terminal ones to match.
//
// Cross-tenant by design: it imports the tenant-agnostic root `db` (no Prisma
// tenant-scope extension) — the same precedent as lambda-sync-avp-policies.ts
// and lib/authz-sync.ts — so a single tick reconciles every tenant's orphans.
// Writes go through `db.workflowExecution.updateMany(...)` directly, mirroring
// exactly what the scoped repo's `markTerminal` sets (status / finishedAt /
// result / errorMessage); we deliberately bypass the scoped repo because the
// extension would scope the write to a (non-existent) request tenant.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule, every minute).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { WorkflowExecutionStatusName } from '@temporalio/client'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { createLogger } from './lib/logger'
import { getTemporalClient } from './lib/temporal-client'

const logger = createLogger('pegasus-reconcile-workflow-executions')
const cloudwatch = new CloudWatchClient({})

// Duplicated literally from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as the other emitters. Keep both
// sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'
const METRIC_NAME = 'WorkflowExecutionReconciled'

/** Don't touch a row until it has been RUNNING for at least this long — gives
 * the worker write-back time to land before we go ask Temporal. */
const GRACE_MS = 5 * 60 * 1000

/** Bound work per tick. If we hit this we log a backlog line and let the next
 * minute's invocation drain the rest. */
const BATCH_SIZE = 100

/** Our terminal enum values. Mirrors the Prisma WorkflowExecutionStatus enum
 * (note: our enum spells it CANCELLED with two Ls). */
type TerminalStatus = 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'

/**
 * Map a Temporal WorkflowExecutionStatusName to our terminal enum. Returns
 * null for non-terminal Temporal states (RUNNING / CONTINUED_AS_NEW / others)
 * — those rows are left alone for a later tick.
 */
function mapTemporalStatus(name: WorkflowExecutionStatusName): TerminalStatus | null {
  switch (name) {
    case 'COMPLETED':
      return 'COMPLETED'
    case 'FAILED':
      return 'FAILED'
    case 'CANCELLED':
      return 'CANCELLED'
    case 'TERMINATED':
      // Operator-killed run — closest terminal state we model is CANCELLED.
      return 'CANCELLED'
    case 'TIMED_OUT':
      return 'TIMED_OUT'
    default:
      // RUNNING, CONTINUED_AS_NEW, PAUSED, UNSPECIFIED, UNKNOWN — not terminal.
      return null
  }
}

async function emitReconciledMetric(status: TerminalStatus): Promise<void> {
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        {
          MetricName: METRIC_NAME,
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date(),
          Dimensions: [{ Name: 'Status', Value: status }],
        },
      ],
    }),
  )
}

export async function handler(): Promise<{ scanned: number; reconciled: number }> {
  const cutoff = new Date(Date.now() - GRACE_MS)

  const orphans = await db.workflowExecution.findMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    take: BATCH_SIZE,
    orderBy: { startedAt: 'asc' },
  })

  logger.info('Scanned for orphaned RUNNING executions', {
    scanned: orphans.length,
    cutoff: cutoff.toISOString(),
  })

  if (orphans.length === 0) {
    return { scanned: 0, reconciled: 0 }
  }

  const client = await getTemporalClient()
  let reconciled = 0

  for (const row of orphans) {
    if (!row.temporalWorkflowId) {
      // RUNNING but never recorded a Temporal id — can't address the run.
      // Don't guess at a terminal state; leave it for a human to inspect.
      logger.warn('RUNNING execution has no temporalWorkflowId — skipping', {
        executionId: row.id,
        tenantId: row.tenantId,
      })
      continue
    }

    try {
      const handle = client.workflow.getHandle(row.temporalWorkflowId)
      const description = await handle.describe()
      const temporalStatus = description.status.name
      const terminal = mapTemporalStatus(temporalStatus)

      if (terminal === null) {
        // Still RUNNING (or CONTINUED_AS_NEW) on Temporal's side — the worker
        // is alive; nothing to reconcile yet. Log CONTINUED_AS_NEW since it is
        // the less-obvious case and worth surfacing.
        if (temporalStatus === 'CONTINUED_AS_NEW') {
          logger.info('Execution continued-as-new on Temporal — leaving RUNNING', {
            executionId: row.id,
            tenantId: row.tenantId,
            temporalWorkflowId: row.temporalWorkflowId,
          })
        }
        continue
      }

      // Pull the payload that the (crashed) worker would have written back.
      let result: Prisma.InputJsonValue | undefined
      let errorMessage: string | undefined
      if (terminal === 'COMPLETED') {
        try {
          const returnValue = await handle.result()
          if (returnValue !== undefined && returnValue !== null) {
            result = returnValue as Prisma.InputJsonValue
          }
        } catch (err) {
          // Shouldn't happen for a COMPLETED run, but don't let a result
          // fetch failure block flipping the status — better a terminal row
          // with no result than a permanent orphan.
          logger.warn('Failed to fetch result for COMPLETED execution', {
            executionId: row.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } else if (terminal === 'FAILED') {
        try {
          await handle.result()
        } catch (err) {
          // result() throws WorkflowFailedError for a failed run; its message
          // (and its `cause`) carry the failure detail.
          const cause =
            err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
          const base = err instanceof Error ? err.message : String(err)
          errorMessage = cause ? `${base}: ${cause}` : base
        }
      }

      // Idempotent write: only flip rows still RUNNING. If the worker's
      // write-back raced in between our read and this update, the
      // `status: 'RUNNING'` predicate makes this a no-op (count: 0) rather
      // than clobbering the worker's terminal payload.
      const data: Prisma.WorkflowExecutionUncheckedUpdateInput = {
        status: terminal,
        finishedAt: new Date(),
      }
      if (result !== undefined) data.result = result
      if (errorMessage !== undefined) data.errorMessage = errorMessage

      const { count } = await db.workflowExecution.updateMany({
        where: { id: row.id, status: 'RUNNING' },
        data,
      })

      if (count === 0) {
        // Already terminal (worker write-back won the race) — nothing to do.
        logger.info('Execution already terminal — skipped (idempotent)', {
          executionId: row.id,
          tenantId: row.tenantId,
        })
        continue
      }

      reconciled += 1
      await emitReconciledMetric(terminal)

      logger.info('Reconciled orphaned RUNNING execution', {
        executionId: row.id,
        tenantId: row.tenantId,
        temporalWorkflowId: row.temporalWorkflowId,
        temporalStatus,
        terminalStatus: terminal,
      })
    } catch (err) {
      // One bad row (e.g. a WorkflowNotFoundError, a transient gRPC error)
      // must not abort the whole tick — the next minute retries it.
      logger.error('Failed to reconcile execution', {
        executionId: row.id,
        tenantId: row.tenantId,
        temporalWorkflowId: row.temporalWorkflowId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (orphans.length === BATCH_SIZE) {
    logger.warn('Reconcile backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  logger.info('Reconcile tick finished', { scanned: orphans.length, reconciled })
  return { scanned: orphans.length, reconciled }
}
