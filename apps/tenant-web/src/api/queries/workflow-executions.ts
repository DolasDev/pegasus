import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  cancelWorkflowInstance,
  getWorkflowInstance,
  getWorkflowInstanceHistory,
  listWorkflowInstances,
  terminateWorkflowInstance,
  type WorkflowInstanceDetail,
} from '@/api/workflow-executions'

// ---------------------------------------------------------------------------
// Durable Workflow instances — /workflows and /workflows/$executionId.
//
// Only DB reads live here. The @workflow.query (which wakes the tenant's
// runner) is NOT a query option on purpose — see features/workflows/
// use-workflow-query.ts.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50
/** The detail page re-reads the stored row this often while it is open, to catch closure. */
export const INSTANCE_ROW_POLL_MS = 15_000

export const workflowInstanceKeys = {
  all: ['workflow-instances'] as const,
  list: (filters: { name?: string; correlationKey?: string; openOnly: boolean }) =>
    [...workflowInstanceKeys.all, 'list', filters] as const,
  detail: (executionId: string) => [...workflowInstanceKeys.all, executionId] as const,
  history: (executionId: string) => [...workflowInstanceKeys.all, executionId, 'history'] as const,
  steps: (executionId: string) => [...workflowInstanceKeys.all, executionId, 'steps'] as const,
}

/** The tenant's durable Workflow instances, newest first, paged by cursor ("Load more"). */
export const workflowInstancesInfiniteQueryOptions = (filters: {
  name?: string
  correlationKey?: string
  openOnly: boolean
}) =>
  infiniteQueryOptions({
    queryKey: workflowInstanceKeys.list(filters),
    queryFn: ({ pageParam }) =>
      listWorkflowInstances({
        kind: 'WORKFLOW',
        open: filters.openOnly,
        ...(filters.name ? { name: filters.name } : {}),
        ...(filters.name && filters.correlationKey
          ? { correlationKey: filters.correlationKey }
          : {}),
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: '' as string,
    getNextPageParam: (last) =>
      last.data.length >= last.limit ? last.data[last.data.length - 1]?.id : undefined,
  })

const isOpen = (row: WorkflowInstanceDetail | undefined) =>
  row?.status === 'QUEUED' || row?.status === 'RUNNING'

/** One instance. Re-reads the stored row every 15 s while it is open (a DB read, not a query). */
export const workflowInstanceQueryOptions = (executionId: string) =>
  queryOptions({
    queryKey: workflowInstanceKeys.detail(executionId),
    queryFn: () => getWorkflowInstance(executionId),
    refetchInterval: (query) => (isOpen(query.state.data) ? INSTANCE_ROW_POLL_MS : false),
  })

/** The Temporal history; the page reads the delivered signals out of it. */
export const workflowInstanceHistoryQueryOptions = (workflowId: string, executionId: string) =>
  queryOptions({
    queryKey: workflowInstanceKeys.history(executionId),
    queryFn: () => getWorkflowInstanceHistory(workflowId, executionId),
  })

/** The step Automations this instance's run_automation() calls started. */
export const workflowInstanceStepsQueryOptions = (executionId: string) =>
  queryOptions({
    queryKey: workflowInstanceKeys.steps(executionId),
    queryFn: () => listWorkflowInstances({ parentExecutionId: executionId, limit: 200 }),
  })

function useInvalidateInstance() {
  const qc = useQueryClient()
  return (executionId: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: workflowInstanceKeys.detail(executionId) }),
      qc.invalidateQueries({ queryKey: [...workflowInstanceKeys.all, 'list'] }),
    ])
}

export function useCancelWorkflowInstance() {
  const invalidate = useInvalidateInstance()
  return useMutation({
    mutationFn: (executionId: string) => cancelWorkflowInstance(executionId),
    onSuccess: (_row, executionId) => invalidate(executionId),
  })
}

export function useTerminateWorkflowInstance() {
  const invalidate = useInvalidateInstance()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ executionId, reason }: { executionId: string; reason: string }) =>
      terminateWorkflowInstance(executionId, reason),
    onSuccess: (_row, { executionId }) =>
      Promise.all([
        invalidate(executionId),
        qc.invalidateQueries({ queryKey: workflowInstanceKeys.steps(executionId) }),
      ]),
  })
}
