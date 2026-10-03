import { queryOptions } from '@tanstack/react-query'
import { getUsageSummary } from '@/api/usage'

export const usageKeys = {
  all: ['usage'] as const,
  summary: (year?: number) => [...usageKeys.all, 'summary', year ?? 'current'] as const,
}

export const usageSummaryQueryOptions = (year?: number) =>
  queryOptions({
    queryKey: usageKeys.summary(year),
    queryFn: () => getUsageSummary(year),
  })
