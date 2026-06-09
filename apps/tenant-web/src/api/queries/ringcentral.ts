import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRingCentralConnections,
  disconnectRingCentralConnection,
  connectRingCentral,
} from '@/api/ringcentral'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const connectionsQueryKey = ['integrations', 'ringcentral', 'connections'] as const

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const ringCentralConnectionsQueryOptions = queryOptions({
  queryKey: connectionsQueryKey,
  queryFn: () => listRingCentralConnections(),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function useConnectRingCentral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { clientId: string; clientSecret: string; jwt: string; number: string }) =>
      connectRingCentral(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectionsQueryKey })
    },
  })
}

export function useDisconnectRingCentral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => disconnectRingCentralConnection(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectionsQueryKey })
    },
  })
}
