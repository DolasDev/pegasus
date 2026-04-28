import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

export const onpremVersionQueryOptions = queryOptions({
  queryKey: ['onprem', 'longhaul', 'version'] as const,
  queryFn: () => apiFetch<unknown>('/api/v1/onprem/longhaul/version'),
  retry: false,
  staleTime: 0,
})
