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
import { ChartCard } from '@/features/reporting/ChartCard'

export function ReportingPage() {
  const definition = BUILTIN_DASHBOARD

  // The catalog supplies column metadata (labels + types) for formatting, and
  // doubles as the feature probe -- it 404s when reporting is disabled.
  const catalog = useQuery(reportingCatalogQueryOptions())
  const data = useQuery(dashboardDataQueryOptions(definition))

  const columnsByDataset = new Map<string, ReportingColumn[]>(
    (catalog.data?.datasets ?? []).map((d) => [d.id, d.columns]),
  )
  const resultsByDataset = new Map((data.data?.results ?? []).map((r) => [r.datasetId, r]))

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
        {definition.widgets.map((widget) => (
          <ChartCard
            key={`${widget.datasetId}:${widget.title}`}
            widget={widget}
            result={resultsByDataset.get(widget.datasetId)}
            columns={columnsByDataset.get(widget.datasetId)}
            isLoading={data.isPending || catalog.isPending}
          />
        ))}
      </div>
    </div>
  )
}
