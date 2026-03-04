import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types — mirror the API response shape (secretArn is never present)
// ---------------------------------------------------------------------------

export type SsoProvidersResponse = {
  providers: SsoProvider[]
  cognitoAuthEnabled: boolean
}

export type SsoProvider = {
  id: string
  name: string
  type: 'OIDC' | 'SAML'
  cognitoProviderName: string
  metadataUrl: string | null
  oidcClientId: string | null
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type CreateSsoProviderInput = {
  name: string
  type: 'OIDC' | 'SAML'
  cognitoProviderName: string
  metadataUrl?: string
  oidcClientId?: string
  isEnabled?: boolean
}

export type UpdateSsoProviderInput = {
  name?: string
  metadataUrl?: string
  oidcClientId?: string
  isEnabled?: boolean
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const ssoProvidersQueryOptions = queryOptions({
  queryKey: ssoKeys.providers(),
  queryFn: () => apiFetch<SsoProvidersResponse>('/api/v1/sso/providers'),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateSsoProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSsoProviderInput) =>
      apiFetch<SsoProvider>('/api/v1/sso/providers', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.providers() })
    },
  })
}

export function useUpdateSsoProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSsoProviderInput }) =>
      apiFetch<SsoProvider>(`/api/v1/sso/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.providers() })
    },
  })
}

export function useDeleteSsoProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/api/v1/sso/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.providers() })
    },
  })
}

export function useUpdateAuthSettings() {
  return useMutation({
    mutationFn: (cognitoAuthEnabled: boolean) =>
      apiFetch<{ cognitoAuthEnabled: boolean }>('/api/v1/sso/providers/auth-settings', {
        method: 'PATCH',
        body: JSON.stringify({ cognitoAuthEnabled }),
      }),
  })
}
