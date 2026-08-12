// ---------------------------------------------------------------------------
// Reporting — TanStack Query bindings.
//
// The whole dashboard is ONE query. That is not a micro-optimization: the API
// Lambda has a reserved concurrency of 10, and the legacy datasets travel over
// the on-prem tunnel, so a per-widget fetch pattern would multiply a single page
// view into a dozen concurrent invocations. `staleTime` keeps refetch churn off
// that path too.
//
// The DTO is declared locally — the repo has no shared client-types package;
// every queries module declares its own (see queries/dashboard.ts).
// ---------------------------------------------------------------------------

import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import type { DashboardDefinition } from '@/features/reporting/dashboard-definition'
import { toQueryRequests } from '@/features/reporting/dashboard-definition'

export interface ReportingColumn {
  key: string
  label: string
  type: 'string' | 'number' | 'currency' | 'date' | 'boolean'
}

export interface ReportingDataset {
  id: string
  version: number
  title: string
  description: string
  source: 'postgres' | 'legacy-mssql'
  permission: string
  columns: ReportingColumn[]
  paramsSchema: unknown
}

export type ReportingRow = Record<string, string | number | boolean | null>

/** One result slot — carries either `rows` or `error`, never both. */
export interface ReportingResult {
  datasetId: string
  rows?: ReportingRow[]
  error?: { message: string; code: string }
}

export const reportingKeys = {
  all: ['reporting'] as const,
  catalog: () => [...reportingKeys.all, 'catalog'] as const,
  dashboard: (id: string) => [...reportingKeys.all, 'dashboard', id] as const,
}

/**
 * The dataset catalog. Doubles as the feature probe: when REPORTING_ENABLED is
 * off the API 404s the whole surface, so a failed catalog query is what hides
 * the nav entry and the route. `retry: false` keeps that probe cheap.
 */
export const reportingCatalogQueryOptions = () =>
  queryOptions({
    queryKey: reportingKeys.catalog(),
    queryFn: () => apiFetch<{ datasets: ReportingDataset[] }>('/api/v1/reporting/datasets'),
    retry: false,
    staleTime: 5 * 60_000,
  })

/**
 * Every widget in one batched request.
 *
 * The cache key is the SLUG plus the widget shape, not a document id: phase 2
 * promoted id/title to real columns, and two different dashboards must not share
 * a cache entry just because they were both "the current one".
 */
export const dashboardDataQueryOptions = (slug: string, def: DashboardDefinition) =>
  queryOptions({
    queryKey: reportingKeys.dashboard(slug),
    queryFn: () =>
      apiFetch<{ results: ReportingResult[] }>('/api/v1/reporting/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: toQueryRequests(def) }),
      }),
    staleTime: 60_000,
  })

// ---------------------------------------------------------------------------
// Phase 2 — stored dashboards and the per-user default.
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  slug: string
  version: number
  title: string
  description: string | null
  visibility: 'GLOBAL' | 'TENANT'
  definition: unknown
  updatedAt: string
  /** Belongs to the caller's tenant (vs a platform-published GLOBAL one). */
  owned: boolean
  /** A GLOBAL dashboard this tenant has not forked yet. */
  forkable: boolean
  forkedFrom: { definitionId: string; version: number | null } | null
}

export interface UserPreferences {
  reporting?: { defaultDashboardSlug?: string | null }
}

export const dashboardKeys = {
  all: ['reporting', 'dashboards'] as const,
  list: () => [...dashboardKeys.all, 'list'] as const,
  preferences: () => ['me', 'preferences'] as const,
}

/**
 * Every dashboard the caller can see. `retry: false` because a 404 here is the
 * feature-disabled signal, same as the catalog.
 */
export const dashboardsQueryOptions = () =>
  queryOptions({
    queryKey: dashboardKeys.list(),
    queryFn: () => apiFetch<{ dashboards: DashboardSummary[] }>('/api/v1/reporting/dashboards'),
    retry: false,
    staleTime: 60_000,
  })

export const userPreferencesQueryOptions = () =>
  queryOptions({
    queryKey: dashboardKeys.preferences(),
    queryFn: () => apiFetch<UserPreferences>('/api/v1/me/preferences'),
    staleTime: 5 * 60_000,
  })

export function setDefaultDashboard(slug: string | null): Promise<UserPreferences> {
  return apiFetch<UserPreferences>('/api/v1/me/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reporting: { defaultDashboardSlug: slug } }),
  })
}

export interface PublishDashboardInput {
  slug: string
  title: string
  description?: string
  definition: unknown
}

export function publishDashboard(input: PublishDashboardInput): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/v1/reporting/dashboards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function forkDashboard(slug: string): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/api/v1/reporting/dashboards/${slug}/fork`, {
    method: 'POST',
  })
}

export function archiveDashboard(slug: string): Promise<{ slug: string }> {
  return apiFetch<{ slug: string }>(`/api/v1/reporting/dashboards/${slug}`, {
    method: 'DELETE',
  })
}
