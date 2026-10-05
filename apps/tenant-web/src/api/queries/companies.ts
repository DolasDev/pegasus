import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCompanyMemberships,
  listCompanies,
  syncCompanyMemberships,
  updateCompanySystemEmployee,
} from '@/api/companies'

export const companyKeys = {
  all: ['companies'] as const,
  list: () => [...companyKeys.all, 'list'] as const,
  memberships: (id: string) => [...companyKeys.all, 'memberships', id] as const,
}

export const companiesQueryOptions = queryOptions({
  queryKey: companyKeys.list(),
  queryFn: () => listCompanies(),
})

export const companyMembershipsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: companyKeys.memberships(id),
    queryFn: () => getCompanyMemberships(id),
  })

export function useSyncCompanyMemberships(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => syncCompanyMemberships(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companyKeys.memberships(id) })
    },
  })
}

export function useUpdateCompanySystemEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: number | null }) =>
      updateCompanySystemEmployee(id, code),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companyKeys.list() })
    },
  })
}
