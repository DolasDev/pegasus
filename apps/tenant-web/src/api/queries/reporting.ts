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

/** Every widget in one batched request. */
export const dashboardDataQueryOptions = (def: DashboardDefinition) =>
  queryOptions({
    queryKey: reportingKeys.dashboard(def.id),
    queryFn: () =>
      apiFetch<{ results: ReportingResult[] }>('/api/v1/reporting/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: toQueryRequests(def) }),
      }),
    staleTime: 60_000,
  })
