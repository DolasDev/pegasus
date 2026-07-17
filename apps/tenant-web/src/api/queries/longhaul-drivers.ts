import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Longhaul drivers — read-only list used by the user-admin "Longhaul driver"
// picker. Sourced from the operations (longhaul) endpoint that the
// driver-planning module already uses; rows come from v_longhaul_drivers and
// are lowercased server-side. A driver login is mapped to one of these so the
// mobile "My Trips" screen can scope the trips list to the logged-in driver.
// ---------------------------------------------------------------------------

export type LonghaulDriver = {
  driver_id: number
  driver_name: string
  agent_code: string | null
  active: string | null
  type: string | null
}

export const longhaulDriverKeys = {
  all: ['longhaul-drivers'] as const,
  list: () => [...longhaulDriverKeys.all, 'list'] as const,
}

export const longhaulDriversQueryOptions = queryOptions({
  queryKey: longhaulDriverKeys.list(),
  queryFn: () => apiFetch<LonghaulDriver[]>('/api/v1/onprem/longhaul/drivers'),
  staleTime: 5 * 60 * 1000,
  // A tenant with no legacy MSSQL gets 422 MSSQL_NOT_CONFIGURED forever — that
  // is a fact about tenant config, not a transient failure, so a retry only
  // doubles the wasted requests.
  retry: false,
})
