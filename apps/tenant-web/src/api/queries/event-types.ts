import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createEventType,
  deleteEventType,
  listEventTypes,
  updateEventType,
  type CreateEventTypeInput,
  type UpdateEventTypeInput,
} from '@/api/event-types'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const eventTypeKeys = {
  all: ['event-types'] as const,
  list: () => [...eventTypeKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const eventTypesQueryOptions = queryOptions({
  queryKey: eventTypeKeys.list(),
  queryFn: () => listEventTypes(),
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function useCreateEventType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEventTypeInput) => createEventType(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventTypeKeys.list() })
    },
  })
}

export function useUpdateEventType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpdateEventTypeInput }) =>
      updateEventType(name, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventTypeKeys.list() })
    },
  })
}

export function useDeleteEventType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteEventType(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventTypeKeys.list() })
    },
  })
}
