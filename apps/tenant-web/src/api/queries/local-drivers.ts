import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Local drivers — read-only list for the user-admin "Local driver" picker.
// Rows are the tenant's active legacy `crews` flagged as local drivers; a
// driver login is mapped to one so it can reach the move chats of the local
// dispatch jobs it drives. Kept separate from the longhaul driver mapping: at
// some tenants the two numbering spaces name different people.
// ---------------------------------------------------------------------------

export type LocalDriver = {
  employeeId: number
  name: string
}

export const localDriverKeys = {
  all: ['local-drivers'] as const,
  list: () => [...localDriverKeys.all, 'list'] as const,
}

export const localDriversQueryOptions = queryOptions({
  queryKey: localDriverKeys.list(),
  queryFn: () => apiFetch<LocalDriver[]>('/api/v1/local-drivers'),
  staleTime: 5 * 60 * 1000,
  // 422 MSSQL_NOT_CONFIGURED is tenant config, not a transient failure.
  retry: false,
})
