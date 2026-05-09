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
  /** Cedar role-group memberships — authoritative source for permission gating. */
  roleNames: string[]
  /** Coarse-grained role string derived from roleNames for display. */
  role: TenantUserRole
  status: TenantUserStatus
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

/** A single Cedar role group as advertised by GET /role-options. */
export interface RoleOption {
  name: string
  label: string
  description: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listTenantUserRoleOptions(tenantId: string): Promise<RoleOption[]> {
  return adminFetch<RoleOption[]>(`/api/admin/tenants/${tenantId}/users/role-options`)
}

export async function listTenantUsers(
  tenantId: string,
): Promise<{ data: TenantUser[]; meta: { count: number } }> {
  return adminFetchPaginated<TenantUser>(`/api/admin/tenants/${tenantId}/users`)
}

export async function inviteTenantUser(
  tenantId: string,
  body: { email: string; roleNames?: string[] },
): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateTenantUserRole(
  tenantId: string,
  userId: string,
  roleNames: string[],
): Promise<TenantUser> {
  return adminFetch<TenantUser>(`/api/admin/tenants/${tenantId}/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ roleNames }),
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
