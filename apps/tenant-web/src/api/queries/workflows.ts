import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  forkWorkflow,
  listExecutions,
  listWorkflows,
  runWorkflow,
  type WorkflowExecution,
} from '@/api/workflows'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const workflowKeys = {
  all: ['workflows'] as const,
  list: () => [...workflowKeys.all, 'list'] as const,
  executions: (id: string) => [...workflowKeys.all, id, 'executions'] as const,
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
