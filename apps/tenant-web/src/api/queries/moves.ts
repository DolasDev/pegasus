import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Move, MoveStatus, Serialized } from '@pegasus/domain'
import { apiFetch, apiFetchPaginated } from '@/api/client'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const moveKeys = {
  all: ['moves'] as const,
  list: () => [...moveKeys.all, 'list'] as const,
  detail: (id: string) => [...moveKeys.all, 'detail', id] as const,
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------
export const movesQueryOptions = queryOptions({
  queryKey: moveKeys.list(),
  queryFn: () => apiFetchPaginated<Serialized<Move>>('/api/v1/moves'),
})

export const moveDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: moveKeys.detail(id),
    queryFn: () => apiFetch<Serialized<Move>>(`/api/v1/moves/${id}`),
    enabled: id !== '',
  })

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
type CreateMoveInput = {
  customerId: string
  scheduledDate: string
  origin: { line1: string; city: string; state: string; postalCode: string; country: string }
  destination: { line1: string; city: string; state: string; postalCode: string; country: string }
}

export function useCreateMove() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMoveInput) =>
      apiFetch<Serialized<Move>>('/api/v1/moves', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: moveKeys.list() })
    },
  })
}

export function useUpdateMoveStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: MoveStatus }) =>
      apiFetch<Serialized<Move>>(`/api/v1/moves/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: moveKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: moveKeys.list() })
    },
  })
}

export function useAssignCrew() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ moveId, crewMemberId }: { moveId: string; crewMemberId: string }) =>
      apiFetch<Serialized<Move>>(`/api/v1/moves/${moveId}/crew`, {
        method: 'POST',
        body: JSON.stringify({ crewMemberId }),
      }),
    onSuccess: (_, { moveId }) => {
      void qc.invalidateQueries({ queryKey: moveKeys.detail(moveId) })
    },
  })
}
