import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCompanyDirectory,
  getCompanyMemberships,
  listCompanies,
  syncCompanyMemberships,
  updateCompanySystemEmployee,
} from '@/api/companies'

export const companyKeys = {
  all: ['companies'] as const,
  list: () => [...companyKeys.all, 'list'] as const,
  memberships: (id: string) => [...companyKeys.all, 'memberships', id] as const,
  directory: (id: string) => [...companyKeys.all, 'directory', id] as const,
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

export const companyDirectoryQueryOptions = (id: string) =>
  queryOptions({
    queryKey: companyKeys.directory(id),
    queryFn: () => getCompanyDirectory(id),
    // A pegII read through the site: don't hammer it, and don't retry a
    // 409/503 that only an operator can fix.
    staleTime: 60_000,
    retry: false,
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
