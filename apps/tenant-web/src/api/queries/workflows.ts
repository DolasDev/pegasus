import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { forkWorkflow, listWorkflows } from '@/api/workflows'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const workflowKeys = {
  all: ['workflows'] as const,
  list: () => [...workflowKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const workflowsQueryOptions = queryOptions({
  queryKey: workflowKeys.list(),
  queryFn: () => listWorkflows(),
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
