// ---------------------------------------------------------------------------
// The one way to address an execution's Temporal workflow: by workflow id with
// `firstExecutionRunId` = the row's run id (the FIRST run — `markStarted`
// stores `handle.firstExecutionRunId`), never by run id.
//
// A durable Workflow that continues-as-new gets a new run id, so a run-pinned
// handle reaches a closed run and every signal / cancel / terminate / query on
// it fails for exactly the long-lived Workflows that need them most.
// `firstExecutionRunId` targets the latest run of THIS chain and never a
// different instance that later reuses the workflow id. Signal, cancel,
// terminate and query all go through here so the addressing can't drift.
// ---------------------------------------------------------------------------

import type { Client, WorkflowHandle } from '@temporalio/client'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'

export function executionHandle(
  client: Client,
  execution: Pick<WorkflowExecutionRow, 'temporalRunId'> & { temporalWorkflowId: string },
): WorkflowHandle {
  return client.workflow.getHandle(
    execution.temporalWorkflowId,
    undefined,
    execution.temporalRunId ? { firstExecutionRunId: execution.temporalRunId } : {},
  )
}
