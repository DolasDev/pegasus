import { queryOptions } from '@tanstack/react-query'
import { apiFetch, apiFetchPaginated } from '@/api/client'

// ---------------------------------------------------------------------------
// Driver itinerary for dispatchers (Operations → Itinerary).
//
// `GET /onprem/longhaul/drivers/itinerary` reads ANY driver's work — longhaul
// trip activities, orders assigned to them on the order itself, and local
// dispatch job acts — as one dated list, Operations roles only. The two ids
// are separate numbering spaces (longhaul `v_longhaul_drivers` vs local
// `crews`); the dispatcher picks each, and nothing here pairs them.
//
// The row contract is copied from apps/api/src/lib/itinerary/types.ts.
// ---------------------------------------------------------------------------

export type ItinerarySource =
  | { kind: 'longhaul-activity'; activityId: number }
  | { kind: 'local-job-token'; jobId: number; token: string | null }
  | { kind: 'order-assigned'; orderNum: number; actCode: string }

export interface ItineraryPlace {
  street: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export interface ItineraryArrivalWindow {
  start: string
  end: string
  tz: string | null
}

export interface ItineraryItem {
  key: string
  source: ItinerarySource
  orderNum: number
  shipperName: string | null
  actCode: string | null
  actName: string
  known: boolean
  kind: 'act' | 'storage'
  side: 'origin' | 'destination' | 'neither'
  place: ItineraryPlace | null
  placeNote: string | null
  day: string
  plannedStart: string | null
  plannedEnd: string | null
  estimated: string | null
  actual: string | null
  arrivalWindow: ItineraryArrivalWindow | null
  committed: boolean
  confirmed: boolean
  sequence: number
  tripId: number | null
  tripStatus: string | null
  drivers: { longhaul: number[]; local: number[] }
}

export type ItinerarySourceName = 'longhaul' | 'order' | 'local'

export interface DriverItinerary {
  items: ItineraryItem[]
  /** Sources that could not be read; the list is partial when non-empty. */
  failedSources: ItinerarySourceName[]
}

export interface DriverItineraryQuery {
  /** Inclusive `YYYY-MM-DD` days, at most 31 apart. */
  from: string
  to: string
  longhaulDriverId: number | null
  localDriverEmployeeId: number | null
}

/** A crew from the tenant's legacy `crews` table (the local numbering space). */
export interface ItineraryCrew {
  employeeId: number
  name: string
}

export const driverItineraryKeys = {
  all: ['driver-itinerary'] as const,
  list: (q: DriverItineraryQuery) => [...driverItineraryKeys.all, 'list', q] as const,
  crews: () => [...driverItineraryKeys.all, 'crews'] as const,
}

export function driverItineraryPath(q: DriverItineraryQuery): string {
  const params = new URLSearchParams({ from: q.from, to: q.to })
  if (q.longhaulDriverId != null) params.set('longhaulDriverId', String(q.longhaulDriverId))
  if (q.localDriverEmployeeId != null)
    params.set('localDriverEmployeeId', String(q.localDriverEmployeeId))
  return `/api/v1/onprem/longhaul/drivers/itinerary?${params.toString()}`
}

export const driverItineraryQueryOptions = (q: DriverItineraryQuery) =>
  queryOptions({
    queryKey: driverItineraryKeys.list(q),
    queryFn: async (): Promise<DriverItinerary> => {
      const res = await apiFetchPaginated<ItineraryItem>(driverItineraryPath(q))
      // The itinerary's meta is its own shape, not PaginationMeta.
      const meta = res.meta as unknown as { failedSources?: ItinerarySourceName[] } | undefined
      return { items: res.data ?? [], failedSources: meta?.failedSources ?? [] }
    },
    // No driver picked ⇒ nothing to ask for (the API would 400).
    enabled: q.longhaulDriverId != null || q.localDriverEmployeeId != null,
    retry: false,
  })

export const itineraryCrewsQueryOptions = queryOptions({
  queryKey: driverItineraryKeys.crews(),
  queryFn: () => apiFetch<ItineraryCrew[]>('/api/v1/onprem/longhaul/local-drivers'),
  staleTime: 5 * 60 * 1000,
  // 422 MSSQL_NOT_CONFIGURED is tenant config, not a transient failure.
  retry: false,
})
