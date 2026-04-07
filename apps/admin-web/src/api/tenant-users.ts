import { adminFetch, ApiError } from './client'
import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'

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
  const token = getAccessToken()
  const res = await fetch(`${getConfig().apiUrl}/api/admin/tenants/${tenantId}/users`, {
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const json = (await res.json()) as
    | { data: TenantUser[]; meta: { count: number } }
    | { error: string; code: string }
  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }
  return json
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
