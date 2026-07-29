import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single RDEL (delivery) activity on the driver's current trip. */
export interface Delivery {
  activityId: number
  plannedStart: string | null
  plannedEnd: string | null
  estimatedDate: string | null
  actualDate: string | null
  isCommitted: boolean
  isConfirmed: boolean
  city: string | null
  state: string | null
}

/**
 * One row per shipment on the driver's current trip, populated with the dates
 * and location of the chronologically FINAL activity on each shipment (any
 * activity type, not just RDEL). Variant A of the Availability screen renders
 * this in place of the per-delivery `deliveries` list.
 */
export interface Shipment extends Delivery {
  orderNum: number
}

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
  /** Planner-maintained Variant-B roster overrides. */
  canada: boolean
  california: boolean
  rating: number | null
  equipment: string | null
  homeCity: string | null
  homeState: string | null
  /** Tri-state WGS flag: true = Yes, false = No, null = Maybe (the unset default). */
  wgs: boolean | null
  /** Driver handles local moves (v_longhaul_drivers.is_local_drv = 'Y'). */
  isLocal: boolean
  /** Driver handles long-distance moves (v_longhaul_drivers.is_long_dist_drv = 'Y'). */
  isLongDistance: boolean
  /** Every RDEL activity on the driver's current trip, sorted by effective date. */
  deliveries: Delivery[]
  /** One row per shipment, dates from the final activity on each. */
  shipments: Shipment[]
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
  queryFn: () => apiFetch<DriverPlanningRow[]>('/api/v1/onprem/longhaul/driver-planning'),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
type UpdateConfirmedInput = {
  driverId: number
  confirmedDate: string | null
  confirmedLocation: string | null
  notes: string | null
  canada?: boolean | null
  california?: boolean | null
  rating?: number | null
  equipment?: string | null
  homeCity?: string | null
  homeState?: string | null
  wgs?: boolean | null
}

export function useUpdateConfirmedAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ driverId, ...body }: UpdateConfirmedInput) =>
      apiFetch<{ success: boolean }>(`/api/v1/onprem/longhaul/driver-planning/${driverId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driverPlanningKeys.list() })
    },
  })
}
