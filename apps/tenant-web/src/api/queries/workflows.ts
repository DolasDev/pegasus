import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createTrigger,
  deleteTrigger,
  forkWorkflow,
  listExecutions,
  listTriggers,
  listWorkflows,
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
  executions: (id: string) => [...workflowKeys.all, id, 'executions'] as const,
  triggers: (id: string) => [...workflowKeys.all, id, 'triggers'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const workflowsQueryOptions = queryOptions({
  queryKey: workflowKeys.list(),
  queryFn: () => listWorkflows(),
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
    mutationFn: ({ id, input }: { id: string; input: unknown }) => runWorkflow(id, input),
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
