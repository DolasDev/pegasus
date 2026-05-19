import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Crew — read-only list used by the user-admin "Linked crew member" picker.
// ---------------------------------------------------------------------------

export type CrewMember = {
  id: string
  name: string
  role: string
  /** The TenantUser this crew member is already linked to, if any. */
  tenantUserId: string | null
}

export const crewKeys = {
  all: ['crew'] as const,
  list: () => [...crewKeys.all, 'list'] as const,
}

export const crewMembersQueryOptions = queryOptions({
  queryKey: crewKeys.list(),
  queryFn: () => apiFetch<CrewMember[]>('/api/v1/crew'),
})
