import { adminFetch, adminFetchPaginated } from './client'
import type { PaginationMeta } from './client'

// ---------------------------------------------------------------------------
// Tenant domain types (mirrors the API's LIST_SELECT / DETAIL_SELECT shapes)
// ---------------------------------------------------------------------------

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED'
export type TenantPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE'

export interface Tenant {
  id: string
  name: string
  slug: string
  status: TenantStatus
  plan: TenantPlan
  contactName: string | null
  contactEmail: string | null
  /**
   * Singleton flag — when true, this tenant's workflow uploads populate the
   * GLOBAL library visible to every other tenant. Promoting/demoting is
   * handled via the dedicated /promote-to-platform and /demote-from-platform
   * routes (not via the generic edit form).
   */
  isPlatformTenant: boolean
  /** ISO 8601 string — Date fields are serialised by Prisma/JSON.stringify. */
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type TenantFilter = 'ALL' | TenantStatus

export interface TenantListParams {
  filter?: TenantFilter
  limit?: number
  offset?: number
}

export interface TenantListResult {
  data: Tenant[]
  meta: PaginationMeta
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listTenants({
  filter = 'ALL',
  limit = 25,
  offset = 0,
}: TenantListParams = {}): Promise<TenantListResult> {
  const query = new URLSearchParams()

  if (filter === 'ALL') {
    // Default server behaviour already excludes OFFBOARDED, which matches
    // the "All" view. No extra param needed.
  } else if (filter === 'OFFBOARDED') {
    query.set('status', 'OFFBOARDED')
  } else {
    query.set('status', filter)
  }

  query.set('limit', String(limit))
  query.set('offset', String(offset))

  return adminFetchPaginated<Tenant>(`/api/admin/tenants?${query.toString()}`)
}

// ---------------------------------------------------------------------------
// Detail type — same shape as the list view (SSO providers are managed via
// the dedicated /api/v1/sso/providers routes in the tenant portal).
// ---------------------------------------------------------------------------

export type TenantDetail = Tenant

// ---------------------------------------------------------------------------
// Mutation payloads
// ---------------------------------------------------------------------------

export interface CreateTenantBody {
  name: string
  slug: string
  plan?: TenantPlan
  contactName?: string
  contactEmail?: string
  /** Email address for the initial tenant administrator. Cognito account is provisioned on creation. */
  adminEmail: string
}

export interface UpdateTenantBody {
  name?: string
  plan?: TenantPlan
  /** Pass null to clear. */
  contactName?: string | null
  /** Pass null to clear. */
  contactEmail?: string | null
}

// ---------------------------------------------------------------------------
// Mutation API calls
// ---------------------------------------------------------------------------

export async function createTenant(body: CreateTenantBody): Promise<TenantDetail> {
  return adminFetch<TenantDetail>('/api/admin/tenants', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateTenant(id: string, body: UpdateTenantBody): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function getTenant(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}`)
}

export async function suspendTenant(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}/suspend`, { method: 'POST' })
}

export async function reactivateTenant(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}/reactivate`, { method: 'POST' })
}

export async function offboardTenant(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}/offboard`, { method: 'POST' })
}

/**
 * Promotes the target tenant to the singleton "platform tenant" role. Any
 * other tenant currently flagged is demoted as a side effect of the same
 * server-side transaction.
 */
export async function promoteToPlatform(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}/promote-to-platform`, {
    method: 'POST',
  })
}

/** Clears the platform-tenant flag. Idempotent: returns the row unchanged if already off. */
export async function demoteFromPlatform(id: string): Promise<TenantDetail> {
  return adminFetch<TenantDetail>(`/api/admin/tenants/${id}/demote-from-platform`, {
    method: 'POST',
  })
}
