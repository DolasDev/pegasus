import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriverPlanningRow {
  driverId: number
  driverName: string
  agentCode: string | null
  currentTripId: number | null
  currentTripTitle: string | null
  estimatedAvailableDate: string | null
  estimatedAvailableLocation: string | null
  confirmedAvailableDate: string | null
  confirmedAvailableLocation: string | null
  confirmedNotes: string | null
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const driverPlanningKeys = {
  all: ['driver-planning'] as const,
  list: () => [...driverPlanningKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------
export const driverPlanningQueryOptions = queryOptions({
  queryKey: driverPlanningKeys.list(),
  queryFn: () => apiFetch<DriverPlanningRow[]>('/api/v1/longhaul/driver-planning'),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
type UpdateConfirmedInput = {
  driverId: number
  confirmedDate: string | null
  confirmedLocation: string | null
  notes: string | null
}

export function useUpdateConfirmedAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ driverId, ...body }: UpdateConfirmedInput) =>
      apiFetch<{ success: boolean }>(`/api/v1/longhaul/driver-planning/${driverId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driverPlanningKeys.list() })
    },
  })
}
