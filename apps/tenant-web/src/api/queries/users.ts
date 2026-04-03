import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types — mirror the API response shape
// ---------------------------------------------------------------------------

export type TenantUser = {
  id: string
  email: string
  cognitoSub: string | null
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

export type InviteUserInput = {
  email: string
  role: 'ADMIN' | 'USER'
}

export type PatchUserInput = {
  role: 'ADMIN' | 'USER'
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const usersKeys = {
  all: ['users'] as const,
  list: () => [...usersKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const usersQueryOptions = queryOptions({
  queryKey: usersKeys.list(),
  queryFn: () => apiFetch<TenantUser[]>('/api/v1/users'),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InviteUserInput) =>
      apiFetch<TenantUser>('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.list() })
    },
  })
}

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchUserInput }) =>
      apiFetch<TenantUser>(`/api/v1/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.list() })
    },
  })
}

export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<TenantUser>(`/api/v1/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.list() })
    },
  })
}
