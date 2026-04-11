import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Customer, Serialized } from '@pegasus/domain'
import { apiFetch } from '@/api/client'

export const customerKeys = {
  all: ['customers'] as const,
  list: () => [...customerKeys.all, 'list'] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export const customersQueryOptions = queryOptions({
  queryKey: customerKeys.list(),
  queryFn: () => apiFetch<Serialized<Customer>[]>('/api/v1/customers'),
})

export const customerDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: customerKeys.detail(id),
    queryFn: () => apiFetch<Serialized<Customer>>(`/api/v1/customers/${id}`),
    enabled: id !== '',
  })

type CreateCustomerInput = {
  firstName: string
  lastName: string
  email: string
  phone?: string
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      apiFetch<Serialized<Customer>>('/api/v1/customers', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customerKeys.list() })
    },
  })
}
