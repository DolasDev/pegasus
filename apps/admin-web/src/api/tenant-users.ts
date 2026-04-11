import { adminFetch, adminFetchPaginated } from './client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TenantUserRole = 'ADMIN' | 'USER'
export type TenantUserStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED'

export interface TenantUser {
  id: string
  email: string
  cognitoSub: string | null
  role: TenantUserRole
  status: TenantUserStatus
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listTenantUsers(
  tenantId: string,
): Promise<{ data: TenantUser[]; meta: { count: number } }> {
  return adminFetchPaginated<TenantUser>(`/api/admin/tenants/${tenantId}/users`)
}

export async function inviteTenantUser(
  tenantId: string,
  body: { email: string; role?: TenantUserRole },
): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateTenantUserRole(
  tenantId: string,
  userId: string,
  role: TenantUserRole,
): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export async function deactivateTenantUser(tenantId: string, userId: string): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users/${userId}`, {
    method: 'DELETE',
  })
}

export async function reactivateTenantUser(tenantId: string, userId: string): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users/${userId}/reactivate`, {
    method: 'POST',
  })
}
