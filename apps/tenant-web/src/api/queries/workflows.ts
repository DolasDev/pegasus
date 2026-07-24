import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  cancelExecution,
  createTrigger,
  deleteTrigger,
  forkWorkflow,
  getRequirementsSummary,
  getWorkflow,
  listExecutionHistory,
  listExecutions,
  listTriggers,
  listWorkflows,
  retryExecution,
  runWorkflow,
  updateTrigger,
  type CreateWorkflowTriggerInput,
  type UpdateWorkflowTriggerInput,
  type WorkflowExecution,
} from '@/api/workflows'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const workflowKeys = {
  all: ['workflows'] as const,
  list: () => [...workflowKeys.all, 'list'] as const,
  detail: (id: string) => [...workflowKeys.all, id, 'detail'] as const,
  executions: (id: string) => [...workflowKeys.all, id, 'executions'] as const,
  executionHistory: (id: string, executionId: string) =>
    [...workflowKeys.all, id, 'executions', executionId, 'history'] as const,
  triggers: (id: string) => [...workflowKeys.all, id, 'triggers'] as const,
  requirementsSummary: () => [...workflowKeys.all, 'requirements-summary'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const workflowsQueryOptions = queryOptions({
  queryKey: workflowKeys.list(),
  queryFn: () => listWorkflows(),
})

/** A single workflow (with its manifest, including the embedded diagram). */
export const workflowQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => getWorkflow(workflowId),
  })

/**
 * Resolved secret/config requirements for every visible workflow (present/missing
 * against the tenant's store). Powers the detail-page badges and the Configs-page
 * "keys still needed" summary.
 */
export const workflowRequirementsSummaryQueryOptions = queryOptions({
  queryKey: workflowKeys.requirementsSummary(),
  queryFn: () => getRequirementsSummary(),
})

/** The Temporal event-history timeline for one execution. */
export const executionHistoryQueryOptions = (workflowId: string, executionId: string) =>
  queryOptions({
    queryKey: workflowKeys.executionHistory(workflowId, executionId),
    queryFn: () => listExecutionHistory(workflowId, executionId),
  })

/**
 * Executions for a single workflow, newest first. Polls every 3s while any row
 * is still in-flight (QUEUED|RUNNING) and stops polling once everything has
 * reached a terminal status.
 */
export const executionsQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowKeys.executions(workflowId),
    queryFn: () => listExecutions(workflowId),
    refetchInterval: (query) => {
      const rows: WorkflowExecution[] = query.state.data?.data ?? []
      const inFlight = rows.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
      return inFlight ? 3000 : false
    },
  })

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Fork a GLOBAL platform-library workflow into the caller's own tenant store.
 * On success the workflows list is invalidated so the new TENANT row appears.
 */
export function useForkWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => forkWorkflow(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.list() })
    },
  })
}

/**
 * Manually trigger a workflow run. On success the workflow's executions list is
 * invalidated so the freshly-queued row appears (and polling kicks in).
 */
export function useRunWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input, dryRun }: { id: string; input: unknown; dryRun?: boolean }) =>
      runWorkflow(id, input, { dryRun }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.executions(id) })
    },
  })
}

/**
 * Request cancellation of a RUNNING execution. On success the executions list is
 * invalidated so polling picks up the eventual CANCELLED transition.
 */
export function useCancelExecution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, executionId }: { id: string; executionId: string }) =>
      cancelExecution(id, executionId),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.executions(id) })
    },
  })
}

/**
 * Retry a failed execution — starts a new run with the original input. On
 * success the executions list is invalidated so the new row appears.
 */
export function useRetryExecution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, executionId }: { id: string; executionId: string }) =>
      retryExecution(id, executionId),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.executions(id) })
    },
  })
}

// ---------------------------------------------------------------------------
// Triggers (Phase 3)
// ---------------------------------------------------------------------------

/** A workflow's triggers, newest first (the caller-tenant's rows only). */
export const triggersQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowKeys.triggers(workflowId),
    queryFn: () => listTriggers(workflowId),
  })

/**
 * Attach an EVENT/SCHEDULE trigger to a workflow. On success the workflow's
 * triggers list is invalidated so the new row appears.
 */
export function useCreateTrigger() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      workflowId,
      input,
    }: {
      workflowId: string
      input: CreateWorkflowTriggerInput
    }) => createTrigger(workflowId, input),
    onSuccess: (_data, { workflowId }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.triggers(workflowId) })
    },
  })
}

/**
 * Partial-update a trigger (the v1 UI only toggles `enabled`). On success the
 * workflow's triggers list is invalidated so the updated row appears.
 */
export function useUpdateTrigger() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      workflowId,
      triggerId,
      input,
    }: {
      workflowId: string
      triggerId: string
      input: UpdateWorkflowTriggerInput
    }) => updateTrigger(workflowId, triggerId, input),
    onSuccess: (_data, { workflowId }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.triggers(workflowId) })
    },
  })
}

/** Delete a trigger. On success the workflow's triggers list is invalidated. */
export function useDeleteTrigger() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ workflowId, triggerId }: { workflowId: string; triggerId: string }) =>
      deleteTrigger(workflowId, triggerId),
    onSuccess: (_data, { workflowId }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.triggers(workflowId) })
    },
  })
}
