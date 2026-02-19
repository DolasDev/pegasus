import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InventoryRoom } from '@pegasus/domain'
import { apiFetch } from '@/api/client'

export const inventoryKeys = {
  all: ['inventory'] as const,
  rooms: (moveId: string) => [...inventoryKeys.all, 'rooms', moveId] as const,
}

export const inventoryRoomsQueryOptions = (moveId: string) =>
  queryOptions({
    queryKey: inventoryKeys.rooms(moveId),
    queryFn: () => apiFetch<InventoryRoom[]>(`/moves/${moveId}/rooms`),
    enabled: moveId !== '',
  })

export function useAddRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ moveId, name }: { moveId: string; name: string }) =>
      apiFetch<InventoryRoom>(`/moves/${moveId}/rooms`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_, { moveId }) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.rooms(moveId) })
    },
  })
}

export function useAddItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      moveId,
      roomId,
      name,
      quantity,
    }: {
      moveId: string
      roomId: string
      name: string
      quantity?: number
    }) =>
      apiFetch<InventoryRoom>(`/moves/${moveId}/rooms/${roomId}/items`, {
        method: 'POST',
        body: JSON.stringify({ name, quantity }),
      }),
    onSuccess: (_, { moveId }) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.rooms(moveId) })
    },
  })
}
