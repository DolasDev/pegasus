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
//
// QUEUED LANE (stranded durable starts). A durable row is inserted QUEUED and
// moved to RUNNING right after Temporal accepts the start; a start that never
// happened (a crash between the insert and the start, or a failed cleanup)
// leaves it QUEUED, which neither lane above ever looks at. Such a row holds an
// open-Workflow slot, keeps the runner sweep demanding a runner, and — for an
// event-routed `wfl/` key — is found as "the open instance" by every later
// event, so the key is stranded. Past STRANDED_QUEUED_MS this lane asks
// Temporal and settles the row:
//   - no instance                                → FAILED (never started)
//   - an instance OWNED BY THIS ROW (memo.executionId), still running
//                                                → RUNNING (adopted)
//   - an instance owned by this row, closed      → its terminal status
//   - an instance owned by ANOTHER row           → FAILED (never started; the
//     row is an orphan beside a live instance, and adopting it would put two
//     RUNNING rows on one instance)
// A FAILED close frees the key: the dispatcher's open-instance lookup reads
// QUEUED / RUNNING rows only, so the next event STARTs a fresh instance.
// Automation QUEUED rows are out of scope (their crash recovery is the runner
// write-back contract, a separate decision).
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
/** A stranded QUEUED durable row closed as never started — each one means a
 * start crashed (or a cleanup failed); kept apart from normal closes. */
const NEVER_STARTED_METRIC_NAME = 'WorkflowExecutionNeverStarted'

/** How long a durable row may stay QUEUED before the QUEUED lane settles it.
 * Only two Lambdas start runs: the API (29 s timeout) and the trigger
 * dispatcher (2 min), so after 10 min no start can still be in flight — which
 * is what makes it safe to close a row `markStarted` (no status predicate)
 * could otherwise still be about to write. */
const STRANDED_QUEUED_MS = 10 * 60 * 1000

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

/** A QUEUED-lane row: the execution plus its workflow's name (to derive the
 * manual-run Temporal id of a row that never recorded one). */
type StrandedRow = ExecutionRow & { workflow: { name: string } }

export async function handler(): Promise<{ scanned: number; reconciled: number }> {
  const cutoff = new Date(Date.now() - GRACE_MS)
  const strandedCutoff = new Date(Date.now() - STRANDED_QUEUED_MS)

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
  const stranded = (await db.workflowExecution.findMany({
    where: { status: 'QUEUED', queuedAt: { lt: strandedCutoff }, workflow: { kind: 'WORKFLOW' } },
    include: { workflow: { select: { name: true } } },
    take: BATCH_SIZE,
    orderBy: { queuedAt: 'asc' },
  })) as StrandedRow[]

  logger.info('Scanned for orphaned RUNNING executions', {
    scanned: orphans.length,
    durableScanned: durables.length,
    strandedScanned: stranded.length,
    cutoff: cutoff.toISOString(),
  })

  let reconciled = 0
  for (const row of orphans) {
    if (await reconcileRow(row, 'AUTOMATION')) reconciled += 1
  }
  for (const row of durables) {
    if (await reconcileRow(row, 'WORKFLOW')) reconciled += 1
  }
  for (const row of stranded) {
    if (await settleStrandedRow(row)) reconciled += 1
  }

  // The AUTOMATION lane only: the WORKFLOW lane is full by design whenever 100+
  // durable Workflows are open, so a full batch there is not a backlog.
  if (orphans.length === BATCH_SIZE) {
    logger.warn('Reconcile backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  // Stranded rows are an anomaly (a crashed start each), so a full batch is.
  if (stranded.length === BATCH_SIZE) {
    logger.warn('Stranded QUEUED backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  const scanned = orphans.length + durables.length + stranded.length
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

/**
 * Settle one stranded QUEUED durable row (see "QUEUED LANE" in the header).
 * Returns true when the row was changed. Never throws; every write is
 * conditional on the row still being QUEUED.
 */
async function settleStrandedRow(row: StrandedRow): Promise<boolean> {
  // A manual run records its Temporal id only at markStarted; it is derivable.
  const temporalWorkflowId =
    row.temporalWorkflowId ?? `wf/${row.tenantId}/${row.workflow.name}/${row.id}`
  const target = { tenantId: row.tenantId, namespace: row.temporalNamespace }
  try {
    const description = await withTemporalClient(target, async (client) => {
      try {
        return await client.workflow.getHandle(temporalWorkflowId).describe()
      } catch (err) {
        if (err instanceof Error && err.name === 'WorkflowNotFoundError') return null
        throw err
      }
    })
    if (description === null) {
      return closeNeverStarted(row, temporalWorkflowId, 'no Temporal instance exists for it')
    }
    // Starts since event-routed signals (#944) record the starting row in the
    // memo. An instance naming another row is that row's: this one is an orphan
    // beside it.
    const owner = description.memo?.['executionId']
    if (owner !== undefined && owner !== row.id) {
      return closeNeverStarted(
        row,
        temporalWorkflowId,
        `its Temporal instance belongs to execution ${String(owner)}`,
      )
    }
    // No memo (a start before #944): the instance is this row's only if no
    // other row already tracks it — e.g. a NEW-mode trigger's QUEUED orphan
    // left by the ALREADY_STARTED path sits beside the RUNNING row that
    // started the same `wf/…/trg/…` id. Adopting it would put two rows on one
    // instance.
    if (owner === undefined) {
      const sibling = await db.workflowExecution.findFirst({
        where: {
          tenantId: row.tenantId,
          temporalWorkflowId,
          id: { not: row.id },
          status: { not: 'QUEUED' },
        },
        select: { id: true },
      })
      if (sibling) {
        return closeNeverStarted(
          row,
          temporalWorkflowId,
          `execution ${sibling.id} already tracks its Temporal instance`,
        )
      }
    }

    const firstRunId = description.raw.workflowExecutionInfo?.firstRunId || description.runId
    const started = {
      temporalWorkflowId,
      temporalRunId: firstRunId,
      startedAt: description.startTime,
    }
    const terminal = mapTemporalStatus(description.status.name)
    if (terminal === null) {
      const { count } = await db.workflowExecution.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: { status: 'RUNNING', ...started },
      })
      if (count > 0) {
        logger.warn('Adopted a stranded QUEUED execution that was running on Temporal', {
          executionId: row.id,
          tenantId: row.tenantId,
          temporalWorkflowId,
        })
      }
      return count > 0
    }

    const outcome = await withTemporalClient(target, (client) =>
      readTemporalOutcome(client, temporalWorkflowId, row.id),
    )
    const data: Prisma.WorkflowExecutionUncheckedUpdateInput = {
      status: terminal,
      finishedAt: new Date(),
      ...started,
    }
    if (outcome.result !== undefined) data.result = outcome.result
    if (outcome.errorMessage !== undefined) data.errorMessage = outcome.errorMessage
    const { count } = await db.workflowExecution.updateMany({
      where: { id: row.id, status: 'QUEUED' },
      data,
    })
    if (count === 0) return false
    await emitReconciledMetric(terminal, 'WORKFLOW')
    logger.warn('Closed a stranded QUEUED execution that had finished on Temporal', {
      executionId: row.id,
      tenantId: row.tenantId,
      temporalWorkflowId,
      terminalStatus: terminal,
    })
    return true
  } catch (err) {
    // Transient (gRPC, a key rotation): the next tick retries the row.
    logger.error('Failed to settle stranded QUEUED execution', {
      executionId: row.id,
      tenantId: row.tenantId,
      temporalWorkflowId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** Close a stranded row as never started (FAILED), freeing its key. */
async function closeNeverStarted(
  row: StrandedRow,
  temporalWorkflowId: string,
  reason: string,
): Promise<boolean> {
  const { count } = await db.workflowExecution.updateMany({
    where: { id: row.id, status: 'QUEUED' },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorMessage: `Not started: this execution stayed queued and ${reason}. Nothing ran.`,
    },
  })
  if (count === 0) return false
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [
          { MetricName: NEVER_STARTED_METRIC_NAME, Value: 1, Unit: 'Count', Timestamp: new Date() },
        ],
      }),
    )
  } catch (err) {
    logger.warn('Failed to publish never-started metric', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  logger.warn('Closed a stranded QUEUED execution as never started', {
    executionId: row.id,
    tenantId: row.tenantId,
    temporalWorkflowId,
    reason,
  })
  return true
}
