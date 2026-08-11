// ---------------------------------------------------------------------------
// /reporting -- the built-in dashboard.
//
// Phase 1 renders BUILTIN_DASHBOARD, a DashboardDefinition parsed from a local
// constant. Phase 2 swaps that one line for a fetched, user-selected definition
// (publishable, forkable, with a per-user default view) and nothing below
// changes -- which is the point of routing everything through the definition
// schema rather than hard-coding widgets here.
//
// The entire dashboard is ONE batched request. See api/queries/reporting.ts for
// why that is load-bearing rather than tidy.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import {
  dashboardDataQueryOptions,
  reportingCatalogQueryOptions,
  type ReportingColumn,
} from '@/api/queries/reporting'
import { BUILTIN_DASHBOARD } from '@/features/reporting/builtin-dashboard'
import type { DashboardDefinition } from '@/features/reporting/dashboard-definition'
import { ChartCard } from '@/features/reporting/ChartCard'

interface ReportingPageProps {
  /**
   * The dashboard to render. Defaults to the built-in one. Phase 2 passes a
   * fetched, user-selected definition here — this prop IS the loader seam, so
   * the page never needs to know where a definition came from.
   */
  definition?: DashboardDefinition
}

export function ReportingPage({ definition = BUILTIN_DASHBOARD }: ReportingPageProps = {}) {
  // The catalog supplies column metadata (labels + types) for formatting, and
  // doubles as the feature probe -- it 404s when reporting is disabled.
  const catalog = useQuery(reportingCatalogQueryOptions())
  const data = useQuery(dashboardDataQueryOptions(definition))

  // Columns are a property of the DATASET, so a map by id is right here.
  const columnsByDataset = new Map<string, ReportingColumn[]>(
    (catalog.data?.datasets ?? []).map((d) => [d.id, d.columns]),
  )
  // Results, by contrast, are matched to widgets POSITIONALLY. Two widgets may
  // legitimately share a dataset with different params ("Moves 30d" next to
  // "Moves 90d"), and a map keyed by datasetId would collapse them so both
  // rendered the same numbers. `toQueryRequests` emits one request per widget in
  // order and the API returns results in request order, so index is the key.
  const results = data.data?.results ?? []

  if (catalog.isError) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reporting</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reporting is not available for this tenant.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{definition.title}</h1>
        {definition.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {definition.widgets.map((widget, i) => (
          <ChartCard
            key={`${widget.datasetId}:${widget.title}`}
            widget={widget}
            result={results[i]}
            columns={columnsByDataset.get(widget.datasetId)}
            isLoading={data.isPending || catalog.isPending}
          />
        ))}
      </div>
    </div>
  )
}
