import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Invoice } from '@pegasus/domain'
import { apiFetch } from '@/api/client'

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: () => [...invoiceKeys.all, 'list'] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
}

export const invoicesQueryOptions = queryOptions({
  queryKey: invoiceKeys.list(),
  queryFn: () => apiFetch<Invoice[]>('/invoices'),
})

export const invoiceDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => apiFetch<Invoice>(`/invoices/${id}`),
    enabled: id !== '',
  })

export function useGenerateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (moveId: string) =>
      apiFetch<Invoice>('/invoices', { method: 'POST', body: JSON.stringify({ moveId }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.list() })
    },
  })
}

export function useRecordPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      invoiceId,
      amount,
      method,
    }: {
      invoiceId: string
      amount: number
      method: string
    }) =>
      apiFetch<Invoice>(`/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount, method }),
      }),
    onSuccess: (_, { invoiceId }) => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void qc.invalidateQueries({ queryKey: invoiceKeys.list() })
    },
  })
}
