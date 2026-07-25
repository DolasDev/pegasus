import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listIntegrations,
  getIntegrationConfig,
  getIntegrationRequirementsSummary,
  listIntegrationConfigVersions,
  forkIntegrationConfig,
  validateIntegrationConfig,
  publishIntegrationConfig,
  rollbackIntegrationConfig,
  type ConfigDraft,
} from '@/api/integrations'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => [...integrationKeys.all, 'list'] as const,
  config: (id: string) => [...integrationKeys.all, 'config', id] as const,
  versions: (id: string) => [...integrationKeys.all, 'versions', id] as const,
  requirementsSummary: () => [...integrationKeys.all, 'requirements-summary'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const integrationsQueryOptions = queryOptions({
  queryKey: integrationKeys.list(),
  queryFn: () => listIntegrations(),
})

/**
 * Resolved secret/config requirements for every integration (present/missing
 * against the tenant's store). Powers the integration detail badges and the
 * Configs-page "keys still needed" summary.
 */
export const integrationRequirementsSummaryQueryOptions = queryOptions({
  queryKey: integrationKeys.requirementsSummary(),
  queryFn: () => getIntegrationRequirementsSummary(),
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

export const integrationConfigVersionsQueryOptions = (integrationId: string) =>
  queryOptions({
    queryKey: integrationKeys.versions(integrationId),
    queryFn: () => listIntegrationConfigVersions(integrationId),
    enabled: integrationId.length > 0,
    retry: false,
  })

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Invalidate the config + versions + list queries for one integration. */
function useInvalidateIntegration() {
  const qc = useQueryClient()
  return (integrationId: string) => {
    void qc.invalidateQueries({ queryKey: integrationKeys.config(integrationId) })
    void qc.invalidateQueries({ queryKey: integrationKeys.versions(integrationId) })
    void qc.invalidateQueries({ queryKey: integrationKeys.list() })
  }
}

/**
 * Fork the GLOBAL platform config into the caller's tenant scope. On success the
 * config/versions/list queries are invalidated so the new TENANT row appears.
 */
export function useForkIntegrationConfig() {
  const invalidate = useInvalidateIntegration()
  return useMutation({
    mutationFn: (integrationId: string) => forkIntegrationConfig(integrationId),
    onSuccess: (row) => invalidate(row.integrationId),
  })
}

/** Dry-run the gate against a candidate config. Does not mutate; no invalidation. */
export function useValidateIntegrationConfig(integrationId: string) {
  return useMutation({
    mutationFn: (draft: ConfigDraft) => validateIntegrationConfig(integrationId, draft),
  })
}

/** Publish a new version of the tenant's own config. */
export function usePublishIntegrationConfig(integrationId: string) {
  const invalidate = useInvalidateIntegration()
  return useMutation({
    mutationFn: (draft: ConfigDraft) => publishIntegrationConfig(integrationId, draft),
    onSuccess: () => invalidate(integrationId),
  })
}

/** Roll a prior version back into a new published version. */
export function useRollbackIntegrationConfig(integrationId: string) {
  const invalidate = useInvalidateIntegration()
  return useMutation({
    mutationFn: (version: number) => rollbackIntegrationConfig(integrationId, version),
    onSuccess: () => invalidate(integrationId),
  })
}
