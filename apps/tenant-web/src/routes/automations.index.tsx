import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ChevronRight, Loader2, Zap } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import {
  workflowRequirementsSummaryQueryOptions,
  workflowsQueryOptions,
} from '@/api/queries/workflows'
import { groupWorkflowsByName } from '@/lib/workflow-grouping'
import { ExecutabilityBadge } from '@/routes/settings.workflows'

// ---------------------------------------------------------------------------
// Automations index — /automations
//
// All-user (non-admin) read-only list of this tenant's OWN automations
// (visibility TENANT), so anyone can check on what is running. One row per
// automation name, linking to its latest version's detail page (diagram +
// executions). Retired versions are already excluded by the API.
//
// Earlier versions stay reachable from the row: executions and triggers belong
// to a single version id, and a trigger is not moved when a new version is
// published, so an older version can still be the one that actually runs. The
// requirements summary's `current` flag (newest version, OR one an enabled
// trigger still runs) marks those as "Still triggered".
//
// The platform library (GLOBAL) is deliberately left out — those are templates
// to fork, not something this tenant runs. Uploading, running, forking and
// trigger management live at Settings → Automations.
// ---------------------------------------------------------------------------

export function AutomationsIndexPage() {
  const { data, isLoading, isError } = useQuery(workflowsQueryOptions)
  const groups = groupWorkflowsByName((data ?? []).filter((w) => w.visibility === 'TENANT'))
  // Best-effort: if the summary fails or predates `current`, the earlier-version
  // links still render, just without the "Still triggered" marker.
  const { data: summary } = useQuery(workflowRequirementsSummaryQueryOptions)
  const currentIds = new Set(
    (summary?.workflows ?? []).filter((w) => w.current).map((w) => w.workflowId),
  )

  return (
    <div>
      <PageHeader title="Automations" breadcrumbs={[{ label: 'Automations' }]} />

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Your automations</h2>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading automations…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={14} className="shrink-0" />
              Failed to load automations.
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              title="No automations yet"
              description="Your team hasn't published any automations. Once one is published it will appear here with its diagram and run history."
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {groups.map(({ name, latest, older }) => (
                <li key={name}>
                  <Link
                    to="/automations/$workflowId"
                    params={{ workflowId: latest.id }}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <Zap size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{name}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          v{latest.version}
                        </Badge>
                        <ExecutabilityBadge workflow={latest} />
                      </div>
                      {latest.manifest.description && (
                        <p className="text-xs text-muted-foreground">
                          {latest.manifest.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  </Link>
                  {older.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pl-11 text-xs text-muted-foreground">
                      <span>Earlier versions:</span>
                      {older.map((w) => (
                        <Link
                          key={w.id}
                          to="/automations/$workflowId"
                          params={{ workflowId: w.id }}
                          className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
                        >
                          v{w.version}
                          {currentIds.has(w.id) && (
                            <Badge variant="secondary" className="font-sans text-[10px]">
                              Still triggered
                            </Badge>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
