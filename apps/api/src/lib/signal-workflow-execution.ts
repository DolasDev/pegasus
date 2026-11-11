// ---------------------------------------------------------------------------
// Signal delivery into a running durable Workflow (kind = WORKFLOW).
//
// One helper shared by the direct route (POST /workflows/:id/executions/
// :executionId/signal) and the trigger dispatcher's event-routed delivery, so
// both refuse the same rows and map Temporal's answers the same way.
//
// A signal is not an execution: it is never charged against the daily quota or
// the open-Workflow cap, and the tenant kill switch does not block it (DECIDE-4:
// the switch stops new runs; open Workflows keep running — and keep receiving
// signals).
//
// Addressing: by Temporal workflow id with `firstExecutionRunId` = the row's
// run id (the FIRST run — `markStarted` stores `handle.firstExecutionRunId`),
// never by run id. A Workflow that continues-as-new gets a new run id, so a
// run-pinned signal would fail forever; `firstExecutionRunId` targets the
// latest run of THIS chain and never a different instance reusing the id.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'
import { TERMINAL_STATUSES } from '../repositories/workflow-execution.repository'
import type { WorkflowRow } from '../repositories/workflow.repository'
import { withTemporalClient } from './temporal-client'
import { ensureTenantRunner } from './tenant-runner'
import { resolveWorkflowRoute } from './workflow-route'
import { logger } from './logger'

export type SignalDurableExecutionOptions = {
  /** The execution's workflow (version) row — the execution row carries no kind. */
  workflow: Pick<WorkflowRow, 'name' | 'executable' | 'kind'>
  execution: WorkflowExecutionRow
  /** A signal the Workflow declares (the caller checks; see declaredSignals). */
  signalName: string
  /** Positional signal arguments: [] or [payload]. */
  args: unknown[]
}

export type SignalDurableExecutionResult =
  /** Temporal accepted the signal. */
  | { outcome: 'SIGNALLED' }
  /** An Automation (or STDLIB) row — only durable Workflows take signals. */
  | { outcome: 'NOT_DURABLE' }
  /** The row is terminal (COMPLETED / FAILED / TIMED_OUT / CANCELLED). */
  | { outcome: 'TERMINAL' }
  /** The row has no Temporal workflow id yet (never started). */
  | { outcome: 'NOT_STARTED' }
  /** Temporal has no running instance (closed ahead of the reconciler, or gone). */
  | { outcome: 'NOT_RUNNING' }
  /** Any other Temporal / connection failure. */
  | { outcome: 'SIGNAL_FAILED'; message: string }

/**
 * The signal names a Workflow version declares (manifest `signals`), or `[]`
 * when it declares none. Publish validates the list; this only reads it.
 */
export function declaredSignals(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) return []
  const signals = (manifest as Record<string, unknown>)['signals']
  return Array.isArray(signals) ? signals.filter((s): s is string => typeof s === 'string') : []
}

/**
 * Deliver `signalName(...args)` to the running Workflow behind `execution`.
 * Never throws: every outcome is modeled. After a successful signal the
 * tenant's runner is ensured (best effort) — a runner may have idle-exited
 * while the Workflow waited, and the signal needs a poller to be handled.
 */
export async function signalDurableExecution(
  db: PrismaClient,
  opts: SignalDurableExecutionOptions,
): Promise<SignalDurableExecutionResult> {
  const { workflow, execution, signalName, args } = opts

  if (resolveWorkflowRoute(workflow) !== 'TENANT_RUNNER' || workflow.kind !== 'WORKFLOW') {
    return { outcome: 'NOT_DURABLE' }
  }
  if (TERMINAL_STATUSES.has(execution.status)) return { outcome: 'TERMINAL' }
  const temporalWorkflowId = execution.temporalWorkflowId
  if (!temporalWorkflowId) return { outcome: 'NOT_STARTED' }

  try {
    await withTemporalClient(
      { tenantId: execution.tenantId, namespace: execution.temporalNamespace },
      (client) =>
        client.workflow
          .getHandle(
            temporalWorkflowId,
            undefined,
            execution.temporalRunId ? { firstExecutionRunId: execution.temporalRunId } : {},
          )
          .signal(signalName, ...args),
    )
  } catch (err) {
    // Match the class by name (the codebase idiom — see the history route).
    // Temporal maps "already completed" to the same not-found error.
    if (err instanceof Error && err.name === 'WorkflowNotFoundError') {
      return { outcome: 'NOT_RUNNING' }
    }
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to signal workflow execution', {
      executionId: execution.id,
      tenantId: execution.tenantId,
      signalName,
      error: message,
    })
    return { outcome: 'SIGNAL_FAILED', message }
  }

  try {
    await ensureTenantRunner(db, execution.tenantId)
  } catch (err) {
    logger.warn('Tenant-runner ensure after signal failed', {
      executionId: execution.id,
      tenantId: execution.tenantId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { outcome: 'SIGNALLED' }
}
