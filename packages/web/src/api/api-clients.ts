import { apiFetch } from './client'

export type ApiClient = {
  id: string
  tenantId: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export type ApiClientWithKey = ApiClient & {
  plainKey: string
}

export async function getApiClients(): Promise<ApiClient[]> {
  return apiFetch<ApiClient[]>('/api/v1/api-clients')
}

export async function getApiClient(id: string): Promise<ApiClient> {
  return apiFetch<ApiClient>(`/api/v1/api-clients/${id}`)
}

export async function createApiClient(data: {
  name: string
  scopes: string[]
}): Promise<ApiClientWithKey> {
  return apiFetch<ApiClientWithKey>('/api/v1/api-clients', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateApiClient(
  id: string,
  data: { name?: string; scopes?: string[] },
): Promise<ApiClient> {
  return apiFetch<ApiClient>(`/api/v1/api-clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function revokeApiClient(id: string): Promise<ApiClient> {
  return apiFetch<ApiClient>(`/api/v1/api-clients/${id}/revoke`, {
    method: 'POST',
  })
}

export async function rotateApiClient(id: string): Promise<ApiClientWithKey> {
  return apiFetch<ApiClientWithKey>(`/api/v1/api-clients/${id}/rotate`, {
    method: 'POST',
  })
}
