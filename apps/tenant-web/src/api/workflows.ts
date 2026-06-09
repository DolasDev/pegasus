import { apiFetch, apiFetchPaginated } from './client'

// ---------------------------------------------------------------------------
// Workflow domain types (mirror apps/api/src/handlers/workflows.ts responses)
// ---------------------------------------------------------------------------

export type WorkflowVisibility = 'GLOBAL' | 'TENANT'

export interface WorkflowManifest {
  name: string
  version: string
  entryPoints: string[]
  description?: string
}

export interface Workflow {
  id: string
  tenantId: string
  name: string
  version: string
  visibility: WorkflowVisibility
  manifest: WorkflowManifest
  createdByUserId: string
  /** Set when this workflow was created by forking another; the source id. */
  forkedFromWorkflowId?: string
  /** The source workflow's version at fork time. */
  forkedFromVersion?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowDownload {
  downloadUrl: string
  expiresInSeconds: number
}

export type WorkflowExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'

export interface WorkflowExecution {
  id: string
  tenantId: string
  workflowId: string
  status: WorkflowExecutionStatus
  /** The JSON input the run was triggered with. */
  input: unknown
  /** The JSON result of a COMPLETED run, else null. */
  result: unknown
  /** Failure detail for FAILED/TIMED_OUT/CANCELLED runs, else null. */
  errorMessage: string | null
  temporalWorkflowId: string | null
  temporalRunId: string | null
  triggeredByUserId: string
  /** ISO-8601 timestamps. */
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Pagination meta returned by the executions list endpoint (cursor-based). */
export interface WorkflowExecutionListMeta {
  count: number
  limit: number
}

export interface ListExecutionsOptions {
  /** Page size (1-200, API default 50). */
  limit?: number
  /** Cursor: the id of the last row on the previous page. */
  before?: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<Workflow[]> {
  return apiFetch<Workflow[]>('/api/v1/workflows')
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/v1/workflows/${id}`)
}

export async function getWorkflowDownloadUrl(id: string): Promise<WorkflowDownload> {
  return apiFetch<WorkflowDownload>(`/api/v1/workflows/${id}/download-url`)
}

/**
 * Fork a GLOBAL platform-library workflow into the caller's own tenant store.
 * Returns the newly-created TENANT-visibility workflow.
 */
export async function forkWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/v1/workflows/${id}/fork`, { method: 'POST' })
}

/**
 * Manually trigger a run of a workflow with the given JSON input. Returns the
 * freshly-enqueued execution row (status QUEUED). Requires `workflow:run`.
 */
export async function runWorkflow(id: string, input: unknown): Promise<WorkflowExecution> {
  return apiFetch<WorkflowExecution>(`/api/v1/workflows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  })
}

/**
 * List a workflow's executions, newest first. Returns both the rows and the
 * list `meta` (`{ count, limit }`). The endpoint is cursor-paginated via
 * `before` (the id of the last row on the previous page) rather than offset.
 */
export async function listExecutions(
  id: string,
  options: ListExecutionsOptions = {},
): Promise<{ data: WorkflowExecution[]; meta: WorkflowExecutionListMeta }> {
  const params = new URLSearchParams()
  if (options.limit != null) params.set('limit', String(options.limit))
  if (options.before != null) params.set('before', options.before)
  const qs = params.toString()
  const path = `/api/v1/workflows/${id}/executions${qs ? `?${qs}` : ''}`
  // The endpoint returns `{ data, meta: { count, limit } }`; apiFetchPaginated
  // preserves the meta envelope (its meta type is the superset PaginationMeta,
  // but only count+limit are populated here).
  const { data, meta } = await apiFetchPaginated<WorkflowExecution>(path)
  return { data, meta: { count: meta.count, limit: meta.limit } }
}

/** Fetch a single execution by id (scoped to the workflow + tenant). */
export async function getExecution(
  id: string,
  executionId: string,
): Promise<WorkflowExecution> {
  return apiFetch<WorkflowExecution>(`/api/v1/workflows/${id}/executions/${executionId}`)
}
