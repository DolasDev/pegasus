import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getApiClients,
  createApiClient,
  updateApiClient,
  revokeApiClient,
  rotateApiClient,
} from '@/api/api-clients'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const apiClientKeys = {
  all: ['api-clients'] as const,
  list: () => [...apiClientKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const apiClientsQueryOptions = queryOptions({
  queryKey: apiClientKeys.list(),
  queryFn: () => getApiClients(),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function useCreateApiClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; scopes: string[] }) => createApiClient(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiClientKeys.list() })
    },
  })
}

export function useUpdateApiClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; scopes?: string[] } }) =>
      updateApiClient(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiClientKeys.list() })
    },
  })
}

export function useRevokeApiClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeApiClient(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiClientKeys.list() })
    },
  })
}

export function useRotateApiClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rotateApiClient(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiClientKeys.list() })
    },
  })
}
