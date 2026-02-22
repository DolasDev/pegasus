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
// Detail type (list + ssoProviderConfig)
// ---------------------------------------------------------------------------

export interface TenantDetail extends Tenant {
  ssoProviderConfig: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Mutation payloads
// ---------------------------------------------------------------------------

export interface CreateTenantBody {
  name: string
  slug: string
  plan?: TenantPlan
  contactName?: string
  contactEmail?: string
}

export interface UpdateTenantBody {
  name?: string
  plan?: TenantPlan
  /** Pass null to clear. */
  contactName?: string | null
  /** Pass null to clear. */
  contactEmail?: string | null
  /** Pass null to clear. */
  ssoProviderConfig?: Record<string, unknown> | null
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
