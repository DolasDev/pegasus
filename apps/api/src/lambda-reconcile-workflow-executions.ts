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
//
// TWO LANES (Phase 3c). Durable Workflows stay RUNNING for days, so they get
// their own batch:
//   - AUTOMATION lane: the crash-recovery backstop above, oldest-first. Durable
//     rows are excluded: 100 open Workflows would otherwise fill this batch on
//     every tick, and no tenant's Automations would be reconciled again.
//   - WORKFLOW lane: a durable Workflow has NO runner write-back (the worker
//     runs it in Temporal; nothing PATCHes the row), so this lane is the only
//     thing that ever closes its row. It round-robins on `reconciledAt` (least
//     recently checked first, never-checked first) and stamps it on every
//     check, so a row closes within about ⌈open Workflows / 100⌉ minutes of
//     finishing. Its closes are counted as WorkflowExecutionClosed, never as
//     WorkflowExecutionReconciled (the crashed-runner alarm).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { Client, WorkflowExecutionStatusName } from '@temporalio/client'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { createLogger } from './lib/logger'
import { withTemporalClient } from './lib/temporal-client'

const logger = createLogger('pegasus-reconcile-workflow-executions')
const cloudwatch = new CloudWatchClient({})

// Duplicated literally from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as the other emitters. Keep both
// sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'
const METRIC_NAME = 'WorkflowExecutionReconciled'
const CLOSED_METRIC_NAME = 'WorkflowExecutionClosed'

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

type Lane = 'AUTOMATION' | 'WORKFLOW'

async function emitReconciledMetric(status: TerminalStatus, lane: Lane): Promise<void> {
  const timestamp = new Date()
  const name = lane === 'WORKFLOW' ? CLOSED_METRIC_NAME : METRIC_NAME
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        // Dimensioned metric — breakdown per terminal status for dashboards.
        {
          MetricName: name,
          Value: 1,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [{ Name: 'Status', Value: status }],
        },
        // Undimensioned metric — total roll-up consumed by the CloudWatch alarm.
        // CloudWatch does NOT automatically aggregate dimensioned metrics into the
        // undimensioned (no-dimension) series, so we publish both explicitly.
        {
          MetricName: name,
          Value: 1,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [],
        },
      ],
    }),
  )
}

type TemporalOutcome = {
  temporalStatus: WorkflowExecutionStatusName
  terminal: TerminalStatus | null
  result?: Prisma.InputJsonValue
  errorMessage?: string
}

/**
 * Describes the run and, if it is terminal, pulls the payload the (crashed)
 * worker would have written back. Read-only, so safe for withTemporalClient
 * to repeat after an auth refusal.
 */
async function readTemporalOutcome(
  client: Client,
  temporalWorkflowId: string,
  executionId: string,
): Promise<TemporalOutcome> {
  const handle = client.workflow.getHandle(temporalWorkflowId)
  const description = await handle.describe()
  const temporalStatus = description.status.name
  const terminal = mapTemporalStatus(temporalStatus)
  const outcome: TemporalOutcome = { temporalStatus, terminal }

  if (terminal === 'COMPLETED') {
    try {
      const returnValue = await handle.result()
      if (returnValue !== undefined && returnValue !== null) {
        outcome.result = returnValue as Prisma.InputJsonValue
      }
    } catch (err) {
      // Shouldn't happen for a COMPLETED run, but don't let a result
      // fetch failure block flipping the status — better a terminal row
      // with no result than a permanent orphan.
      logger.warn('Failed to fetch result for COMPLETED execution', {
        executionId,
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
      outcome.errorMessage = cause ? `${base}: ${cause}` : base
    }
  }
  return outcome
}

type ExecutionRow = Awaited<ReturnType<typeof db.workflowExecution.findMany>>[number]

export async function handler(): Promise<{ scanned: number; reconciled: number }> {
  const cutoff = new Date(Date.now() - GRACE_MS)

  const orphans = await db.workflowExecution.findMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff }, workflow: { kind: 'AUTOMATION' } },
    take: BATCH_SIZE,
    orderBy: { startedAt: 'asc' },
  })
  const durables = await db.workflowExecution.findMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff }, workflow: { kind: 'WORKFLOW' } },
    take: BATCH_SIZE,
    orderBy: { reconciledAt: { sort: 'asc', nulls: 'first' } },
  })

  logger.info('Scanned for orphaned RUNNING executions', {
    scanned: orphans.length,
    durableScanned: durables.length,
    cutoff: cutoff.toISOString(),
  })

  let reconciled = 0
  for (const row of orphans) {
    if (await reconcileRow(row, 'AUTOMATION')) reconciled += 1
  }
  for (const row of durables) {
    if (await reconcileRow(row, 'WORKFLOW')) reconciled += 1
  }

  // The AUTOMATION lane only: the WORKFLOW lane is full by design whenever 100+
  // durable Workflows are open, so a full batch there is not a backlog.
  if (orphans.length === BATCH_SIZE) {
    logger.warn('Reconcile backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  const scanned = orphans.length + durables.length
  logger.info('Reconcile tick finished', { scanned, reconciled })
  return { scanned, reconciled }
}

/**
 * Ask Temporal about one RUNNING row and flip it if the run is terminal.
 * Returns true when the row was flipped. Never throws: one bad row (e.g. a
 * WorkflowNotFoundError, a transient gRPC error) must not abort the tick.
 * WORKFLOW-lane rows get `reconciledAt` stamped on every check, terminal or
 * not — that stamp is what moves the lane's round-robin along.
 */
async function reconcileRow(row: ExecutionRow, lane: Lane): Promise<boolean> {
  const checkedAt = new Date()
  const stamp = lane === 'WORKFLOW' ? { reconciledAt: checkedAt } : {}
  if (!row.temporalWorkflowId) {
    // RUNNING but never recorded a Temporal id — can't address the run.
    // Don't guess at a terminal state; leave it for a human to inspect.
    logger.warn('RUNNING execution has no temporalWorkflowId — skipping', {
      executionId: row.id,
      tenantId: row.tenantId,
    })
    if (lane === 'WORKFLOW') await stampChecked(row.id, checkedAt)
    return false
  }

  try {
    const temporalWorkflowId = row.temporalWorkflowId
    // Ask the namespace the run was started in (3b.2): the row records it.
    const read = await withTemporalClient(
      { tenantId: row.tenantId, namespace: row.temporalNamespace },
      (client) => readTemporalOutcome(client, temporalWorkflowId, row.id),
    )
    const { temporalStatus, terminal, result, errorMessage } = read

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
      if (lane === 'WORKFLOW') await stampChecked(row.id, checkedAt)
      return false
    }

    // Idempotent write: only flip rows still RUNNING. If the worker's
    // write-back raced in between our read and this update, the
    // `status: 'RUNNING'` predicate makes this a no-op (count: 0) rather
    // than clobbering the worker's terminal payload.
    const data: Prisma.WorkflowExecutionUncheckedUpdateInput = {
      status: terminal,
      finishedAt: new Date(),
      ...stamp,
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
      return false
    }

    await emitReconciledMetric(terminal, lane)

    logger.info(
      lane === 'WORKFLOW'
        ? 'Closed durable Workflow execution'
        : 'Reconciled orphaned RUNNING execution',
      {
        executionId: row.id,
        tenantId: row.tenantId,
        temporalWorkflowId: row.temporalWorkflowId,
        temporalStatus,
        terminalStatus: terminal,
      },
    )
    return true
  } catch (err) {
    // One bad row must not abort the whole tick — the next minute retries it.
    // A WORKFLOW-lane row is still stamped, so a persistently failing row
    // goes to the back of the round-robin instead of pinning the batch.
    logger.error('Failed to reconcile execution', {
      executionId: row.id,
      tenantId: row.tenantId,
      temporalWorkflowId: row.temporalWorkflowId,
      error: err instanceof Error ? err.message : String(err),
    })
    if (lane === 'WORKFLOW') await stampChecked(row.id, checkedAt)
    return false
  }
}

/** Stamp a WORKFLOW-lane check; a failure only delays the round-robin. */
async function stampChecked(id: string, checkedAt: Date): Promise<void> {
  await db.workflowExecution
    .updateMany({ where: { id, status: 'RUNNING' }, data: { reconciledAt: checkedAt } })
    .catch((err: unknown) => {
      logger.warn('Failed to stamp reconciledAt', {
        executionId: id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}
