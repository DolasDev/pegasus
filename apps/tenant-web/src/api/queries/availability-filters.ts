import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Saved filters for Operations → Availability (/api/v1/availability-filters).
//
// The persisted `query` mirrors apps/api/src/lib/availability-filter-query.ts.
// Dates are day offsets from today; zones are codes. Conversion to/from View
// A's filter-bar state lives in features/driver-planning/availability/
// availability-filter-query.ts.
// ---------------------------------------------------------------------------

export type AvailabilityMoveType = 'local' | 'longDistance' | 'shorthaul'

export interface SavedAvailabilityQuery {
  v: 1
  driverName: string
  zones: string[]
  moveTypes: AvailabilityMoveType[]
  dateFromOffsetDays: number | null
  dateToOffsetDays: number | null
  sortOrder: 'asc' | 'desc' | null
}

export interface AvailabilityFilter {
  id: string
  name: string
  query: SavedAvailabilityQuery
  isPublic: boolean
  isDefault: boolean
  owner: { id: string; email: string }
  createdAt: string
  updatedAt: string
}

export type AvailabilityFilterScope = 'mine' | 'public'

const BASE = '/api/v1/availability-filters'

export const availabilityFilterKeys = {
  all: ['availability-filters'] as const,
  list: (scope: AvailabilityFilterScope) => [...availabilityFilterKeys.all, 'list', scope] as const,
  default: () => [...availabilityFilterKeys.all, 'default'] as const,
}

export const availabilityFiltersQueryOptions = (scope: AvailabilityFilterScope) =>
  queryOptions({
    queryKey: availabilityFilterKeys.list(scope),
    queryFn: () => apiFetch<AvailabilityFilter[]>(`${BASE}?scope=${scope}`),
  })

export const defaultAvailabilityFilterQueryOptions = queryOptions({
  queryKey: availabilityFilterKeys.default(),
  queryFn: () => apiFetch<AvailabilityFilter | null>(`${BASE}/default`),
  // The default is read once to seed the page; never refetch it out from
  // under a user who has since changed the filters.
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: false,
})

export interface SaveAvailabilityFilterInput {
  name: string
  query: SavedAvailabilityQuery
  isPublic: boolean
  isDefault: boolean
}

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: availabilityFilterKeys.all })
}

export function useSaveAvailabilityFilter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: SaveAvailabilityFilterInput) =>
      apiFetch<AvailabilityFilter>(BASE, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  })
}

export function useSetDefaultAvailabilityFilter() {
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

export function useDeleteAvailabilityFilter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
