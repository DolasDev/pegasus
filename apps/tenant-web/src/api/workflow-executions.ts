import { apiFetch, apiFetchPaginated } from './client'
import type { WorkflowExecution, WorkflowHistoryEvent, WorkflowKind } from './workflows'

// ---------------------------------------------------------------------------
// /api/v1/workflow-executions — executions by id alone, tenant-wide
// (mirrors apps/api/src/handlers/workflow-executions.ts).
//
// One durable Workflow's instances span every version of its name, and a step
// knows its parent only by id, so these routes take no workflow (version) id.
// ---------------------------------------------------------------------------

/** One row of GET /workflow-executions: the execution plus its kind and key. */
export interface WorkflowInstance extends WorkflowExecution {
  /** Name + version of the version row this execution runs (null if deleted). */
  workflowName: string | null
  workflowVersion: string | null
  /** The executed row's kind; null only if the row was deleted. */
  kind: WorkflowKind | null
  /** Business key of an event-routed instance; null for a manual run or an Automation. */
  correlationKey: string | null
}

/** GET /workflow-executions/:id — the row plus what its version declares. */
export interface WorkflowInstanceDetail extends WorkflowInstance {
  /** Signal names the version declares (empty for an Automation). */
  signals: string[]
  /** Query names the version declares (empty for an Automation). */
  queries: string[]
}

export interface ListWorkflowInstancesOptions {
  kind?: WorkflowKind
  /** Only QUEUED / RUNNING. Undefined lets the API default (open for WORKFLOW). */
  open?: boolean
  name?: string
  /** With `name`: the one instance of that event-routed key. */
  correlationKey?: string
  /** A durable Workflow execution id: list the step Automations it started. */
  parentExecutionId?: string
  limit?: number
  /** Cursor: the id of the last row on the previous page. */
  before?: string
}

export function workflowInstancesPath(options: ListWorkflowInstancesOptions = {}): string {
  const params = new URLSearchParams()
  if (options.kind) params.set('kind', options.kind)
  if (options.open !== undefined) params.set('open', options.open ? 'true' : 'false')
  if (options.name) params.set('name', options.name)
  if (options.correlationKey) params.set('correlationKey', options.correlationKey)
  if (options.parentExecutionId) params.set('parentExecutionId', options.parentExecutionId)
  if (options.limit != null) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  const qs = params.toString()
  return `/api/v1/workflow-executions${qs ? `?${qs}` : ''}`
}

/** List executions tenant-wide; by default the OPEN durable Workflows. Needs ReadWorkflow. */
export async function listWorkflowInstances(
  options: ListWorkflowInstancesOptions = {},
): Promise<{ data: WorkflowInstance[]; limit: number }> {
  const { data, meta } = await apiFetchPaginated<WorkflowInstance>(workflowInstancesPath(options))
  return { data, limit: meta.limit }
}

export async function getWorkflowInstance(executionId: string): Promise<WorkflowInstanceDetail> {
  return apiFetch<WorkflowInstanceDetail>(
    `/api/v1/workflow-executions/${encodeURIComponent(executionId)}`,
  )
}

/** The Temporal history timeline; signals show as WorkflowExecutionSignaled + signalName. */
export async function getWorkflowInstanceHistory(
  workflowId: string,
  executionId: string,
): Promise<WorkflowHistoryEvent[]> {
  const { events } = await apiFetch<{ events: WorkflowHistoryEvent[] }>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}/history`,
  )
  return events
}

/**
 * Run a declared @workflow.query (QueryWorkflowExecution). Each call wakes the
 * tenant's runner: never call this on a timer. A cold runner answers 503
 * WORKFLOW_WORKER_STARTING; see `useWorkflowQuery` for the retry loop.
 */
export async function queryWorkflowInstance(
  executionId: string,
  name: string,
  args: unknown[] = [],
  signal?: AbortSignal,
): Promise<unknown> {
  const { result } = await apiFetch<{ result: unknown }>(
    `/api/v1/workflow-executions/${encodeURIComponent(executionId)}/query`,
    { method: 'POST', body: JSON.stringify({ name, args }), signal },
  )
  return result
}

/** Cooperative cancel (CancelWorkflowExecution): the Workflow's code decides what to do. */
export async function cancelWorkflowInstance(executionId: string): Promise<WorkflowInstance> {
  return apiFetch<WorkflowInstance>(
    `/api/v1/workflow-executions/${encodeURIComponent(executionId)}/cancel`,
    { method: 'POST' },
  )
}

/**
 * Forcible end (TerminateWorkflowExecution): no more of the Workflow's code
 * runs, the row closes as CANCELLED ("Terminated: <reason>"), and its open
 * steps are cancelled.
 */
export async function terminateWorkflowInstance(
  executionId: string,
  reason: string,
): Promise<WorkflowInstance> {
  return apiFetch<WorkflowInstance>(
    `/api/v1/workflow-executions/${encodeURIComponent(executionId)}/terminate`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  )
}
