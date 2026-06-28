import { queryOptions } from '@tanstack/react-query'
import { listIntegrations, getIntegrationConfig } from '@/api/integrations'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => [...integrationKeys.all, 'list'] as const,
  config: (id: string) => [...integrationKeys.all, 'config', id] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const integrationsQueryOptions = queryOptions({
  queryKey: integrationKeys.list(),
  queryFn: () => listIntegrations(),
})

export const integrationConfigQueryOptions = (integrationId: string) =>
  queryOptions({
    queryKey: integrationKeys.config(integrationId),
    queryFn: () => getIntegrationConfig(integrationId),
    enabled: integrationId.length > 0,
    // A 404 (no published config) is an expected state, not a transient error —
    // don't retry it; the page renders an empty state instead.
    retry: false,
  })
