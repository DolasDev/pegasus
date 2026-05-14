import { queryOptions } from '@tanstack/react-query'
import { listWorkflows } from '@/api/workflows'

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
