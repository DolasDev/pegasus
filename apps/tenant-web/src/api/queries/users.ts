import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types — mirror the API response shape
// ---------------------------------------------------------------------------

export type TenantUser = {
  id: string
  email: string
  cognitoSub: string | null
  legacyWindowsUsername: string | null
  roleNames: string[]
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
  /** The CrewMember.id linked to this login (driver persona), or null. */
  crewMemberId: string | null
  /** The linked CrewMember's display name, or null. */
  crewMemberName: string | null
}

export type InviteUserInput = {
  email: string
  /** Cedar role-group memberships (e.g. ['viewer'], ['local_dispatch']). */
  roleNames: string[]
}

export type PatchUserInput = {
  /** Cedar role-group memberships. */
  roleNames?: string[]
  legacyWindowsUsername?: string | null
  /** CrewMember to link this login to (driver persona); null unlinks. */
  crewMemberId?: string | null
}

/** A single Cedar role group as advertised by GET /role-options. */
export type RoleOption = {
  name: string
  label: string
  description: string
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const usersKeys = {
  all: ['users'] as const,
  list: () => [...usersKeys.all, 'list'] as const,
  roleOptions: () => [...usersKeys.all, 'role-options'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const usersQueryOptions = queryOptions({
  queryKey: usersKeys.list(),
  queryFn: () => apiFetch<TenantUser[]>('/api/v1/users'),
})

export const roleOptionsQueryOptions = queryOptions({
  queryKey: usersKeys.roleOptions(),
  queryFn: () => apiFetch<RoleOption[]>('/api/v1/users/role-options'),
  staleTime: Infinity,
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

export function useUpdateUserLegacyWindowsUsername() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      legacyWindowsUsername,
    }: {
      id: string
      legacyWindowsUsername: string | null
    }) =>
      apiFetch<TenantUser>(`/api/v1/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ legacyWindowsUsername }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.list() })
    },
  })
}

export function useLinkCrewMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, crewMemberId }: { id: string; crewMemberId: string | null }) =>
      apiFetch<TenantUser>(`/api/v1/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ crewMemberId }),
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
