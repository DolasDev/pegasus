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
  /**
   * Cedar action ids the workflow needs at runtime (display-only — static
   * role applies, no dynamic scoping in Phase 3). Present in manifests
   * uploaded after Unit 10; absent in earlier rows.
   */
  requiredActions?: string[]
  /**
   * Per-execution Temporal workflow timeout the manifest declared (seconds).
   * Absent means the platform default (900 s). Display-only.
   */
  timeoutSeconds?: number
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
  /**
   * SHA-256 hex digest of the artifact zip (Phase 3 Unit 6). Null on rows
   * finalized before artifact validation existed.
   */
  artifactSha256: string | null
  /**
   * Whether the artifact has passed integrity validation and is eligible for
   * execution on the TENANT_RUNNER lane. Always true for curated (STDLIB)
   * workflows once they have a sha256. False/null on pre-Unit-6 rows — those
   * need to be re-uploaded to become executable.
   */
  executable: boolean
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

/** How an execution was started: a user's manual run, an EVENT trigger
 * matching a domain event, or a SCHEDULE trigger's cron fire. */
export type WorkflowTriggerSource = 'USER' | 'EVENT' | 'SCHEDULE'

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
  /** Null for trigger-fired executions (no user behind EVENT/SCHEDULE runs). */
  triggeredByUserId: string | null
  triggerSource: WorkflowTriggerSource
  /** The WorkflowTrigger that fired this run (EVENT/SCHEDULE), else null. */
  triggeredByTriggerId: string | null
  /** ISO-8601 timestamps. */
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Workflow triggers (Phase 3) — mirror the WorkflowTriggerResponse wire shape
// in apps/api/src/handlers/workflows.ts
// ---------------------------------------------------------------------------

export type WorkflowTriggerKind = 'EVENT' | 'SCHEDULE'

/**
 * The five launch domain-event types an EVENT trigger can subscribe to.
 * KEEP IN SYNC with `DOMAIN_EVENT_TYPES` in `apps/api/src/lib/domain-events.ts`
 * — tenant-web cannot import from apps/api, so the taxonomy is duplicated
 * here. The names are a public contract (renames are breaking), so drift
 * should be rare; additions land in both places.
 */
export const DOMAIN_EVENT_TYPES = [
  'quote.accepted',
  'move.status_changed',
  'invoice.paid',
  'customer.created',
  'pegasus_event.received',
] as const

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number]

/**
 * Platform-provided integration event types (legacy pegII / MoveManager) an
 * EVENT trigger can subscribe to, globally available to every tenant. KEEP IN
 * SYNC with `INTEGRATION_EVENT_TYPES` in `apps/api/src/lib/domain-events.ts`
 * (tenant-web cannot import from apps/api). Names are the lowercased pegII
 * catalogue DetailTypes under the `pegii.` namespace.
 */
export const INTEGRATION_EVENT_TYPES = ['pegii.shipment.opened', 'pegii.shipment.closed'] as const

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number]

export interface WorkflowTrigger {
  id: string
  tenantId: string
  workflowId: string
  kind: WorkflowTriggerKind
  /** The subscribed domain event (EVENT triggers), else null. */
  eventType: string | null
  /** Shallow equality filter on the event payload (EVENT triggers), else
   * null. Empty/null = match every event of the subscribed type. */
  filter: Record<string, unknown> | null
  /** 5-field UTC cron expression (SCHEDULE triggers), else null. */
  cronExpression: string | null
  enabled: boolean
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowTriggerInput {
  kind: WorkflowTriggerKind
  /** Required for EVENT triggers; rejected for SCHEDULE. */
  eventType?: string
  /** EVENT triggers only — plain JSON object, scalar values. */
  filter?: Record<string, unknown>
  /** Required for SCHEDULE triggers; rejected for EVENT. */
  cronExpression?: string
  enabled?: boolean
}

/** PATCH body — all fields optional; `kind` is immutable (delete + recreate).
 * The v1 UI only ever sends `{ enabled }`. */
export interface UpdateWorkflowTriggerInput {
  enabled?: boolean
  eventType?: string
  filter?: Record<string, unknown>
  cronExpression?: string
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
export async function getExecution(id: string, executionId: string): Promise<WorkflowExecution> {
  return apiFetch<WorkflowExecution>(`/api/v1/workflows/${id}/executions/${executionId}`)
}

// ---------------------------------------------------------------------------
// Trigger CRUD — `/api/v1/workflows/:id/triggers[/:triggerId]`
// ---------------------------------------------------------------------------

/**
 * List the caller-tenant's triggers on a workflow, newest first. Includes
 * triggers the tenant attached to a GLOBAL workflow (each tenant only ever
 * sees its own rows).
 */
export async function listTriggers(id: string): Promise<WorkflowTrigger[]> {
  return apiFetch<WorkflowTrigger[]>(`/api/v1/workflows/${id}/triggers`)
}

/**
 * Attach an EVENT or SCHEDULE trigger to a workflow. Requires
 * `workflow:manage_triggers`. Returns the created row (201).
 */
export async function createTrigger(
  id: string,
  input: CreateWorkflowTriggerInput,
): Promise<WorkflowTrigger> {
  return apiFetch<WorkflowTrigger>(`/api/v1/workflows/${id}/triggers`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * Partial-update a trigger (`kind` is immutable — the API 400s on it).
 * Requires `workflow:manage_triggers`.
 */
export async function updateTrigger(
  id: string,
  triggerId: string,
  input: UpdateWorkflowTriggerInput,
): Promise<WorkflowTrigger> {
  return apiFetch<WorkflowTrigger>(`/api/v1/workflows/${id}/triggers/${triggerId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** Hard-delete a trigger (204). Requires `workflow:manage_triggers`. */
export async function deleteTrigger(id: string, triggerId: string): Promise<void> {
  await apiFetch<null>(`/api/v1/workflows/${id}/triggers/${triggerId}`, { method: 'DELETE' })
}
