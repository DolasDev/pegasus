import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Quote, Serialized } from '@pegasus/domain'
import { apiFetch } from '@/api/client'

export const quoteKeys = {
  all: ['quotes'] as const,
  list: () => [...quoteKeys.all, 'list'] as const,
  detail: (id: string) => [...quoteKeys.all, 'detail', id] as const,
  forCustomer: (customerId: string) => [...quoteKeys.all, 'customer', customerId] as const,
}

export const quotesQueryOptions = queryOptions({
  queryKey: quoteKeys.list(),
  queryFn: () => apiFetch<Serialized<Quote>[]>('/api/v1/quotes'),
})

export const quoteDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: quoteKeys.detail(id),
    queryFn: () => apiFetch<Serialized<Quote>>(`/api/v1/quotes/${id}`),
    enabled: id !== '',
  })

export const customerQuotesQueryOptions = (customerId: string) =>
  queryOptions({
    queryKey: quoteKeys.forCustomer(customerId),
    queryFn: () => apiFetch<Serialized<Quote>[]>(`/api/v1/customers/${customerId}/quotes`),
    enabled: customerId !== '',
  })

export function useFinalizeQuote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Serialized<Quote>>(`/api/v1/quotes/${id}/finalize`, { method: 'POST' }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: quoteKeys.detail(String(data.id)) })
      void qc.invalidateQueries({ queryKey: quoteKeys.list() })
    },
  })
}

export function useAddLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      quoteId,
      description,
      quantity,
      unitPrice,
    }: {
      quoteId: string
      description: string
      quantity: number
      unitPrice: number
    }) =>
      apiFetch<Serialized<Quote>>(`/api/v1/quotes/${quoteId}/line-items`, {
        method: 'POST',
        body: JSON.stringify({ description, quantity, unitPrice }),
      }),
    onSuccess: (_, { quoteId }) => {
      void qc.invalidateQueries({ queryKey: quoteKeys.detail(quoteId) })
    },
  })
}
