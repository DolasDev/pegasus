import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Saved filters for Operations → Services (/api/v1/services-filters).
//
// The persisted `query` mirrors apps/api/src/lib/services-filter-query.ts. The
// dates are day offsets from today, and selections are bare values. The
// conversion to and from the board's redux query lives in
// features/driver-planning/containers/Activities/services-filter-query.ts.
// ---------------------------------------------------------------------------

export interface SavedServicesQuery {
  v: 1
  dateFromOffsetDays: number
  dateToOffsetDays: number
  activityTypes: string[]
  shortHaul: ('Y' | 'N')[]
  dispatchers: string[]
  sortBy: { value: string; order: 'asc' | 'desc' } | null
}

export interface ServicesFilter {
  id: string
  name: string
  query: SavedServicesQuery
  isPublic: boolean
  isDefault: boolean
  owner: { id: string; email: string }
  createdAt: string
  updatedAt: string
}

export type ServicesFilterScope = 'mine' | 'public'

const BASE = '/api/v1/services-filters'

export const servicesFilterKeys = {
  all: ['services-filters'] as const,
  list: (scope: ServicesFilterScope) => [...servicesFilterKeys.all, 'list', scope] as const,
  default: () => [...servicesFilterKeys.all, 'default'] as const,
}

export const servicesFiltersQueryOptions = (scope: ServicesFilterScope) =>
  queryOptions({
    queryKey: servicesFilterKeys.list(scope),
    queryFn: () => apiFetch<ServicesFilter[]>(`${BASE}?scope=${scope}`),
  })

export const defaultServicesFilterQueryOptions = queryOptions({
  queryKey: servicesFilterKeys.default(),
  queryFn: () => apiFetch<ServicesFilter | null>(`${BASE}/default`),
  // Read once to seed the board; never refetched out from under a user who
  // has since changed the filters.
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: false,
})

export interface SaveServicesFilterInput {
  name: string
  query: SavedServicesQuery
  isPublic: boolean
  isDefault: boolean
}

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: servicesFilterKeys.all })
}

export function useSaveServicesFilter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: SaveServicesFilterInput) =>
      apiFetch<ServicesFilter>(BASE, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  })
}

export function useSetDefaultServicesFilter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (filterId: string | null) =>
      apiFetch<{ filterId: string | null }>(`${BASE}/default`, {
        method: 'PUT',
        body: JSON.stringify({ filterId }),
      }),
    onSuccess: invalidate,
  })
}

export function useDeleteServicesFilter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
