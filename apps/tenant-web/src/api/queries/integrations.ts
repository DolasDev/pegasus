import { queryOptions } from '@tanstack/react-query'
import { listIntegrations } from '@/api/integrations'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => [...integrationKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const integrationsQueryOptions = queryOptions({
  queryKey: integrationKeys.list(),
  queryFn: () => listIntegrations(),
})
