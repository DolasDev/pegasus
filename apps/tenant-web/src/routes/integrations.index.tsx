import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Blocks, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { integrationsQueryOptions } from '@/api/queries/integrations'

// ---------------------------------------------------------------------------
// Integrations index — /integrations
//
// All-user (non-admin) read-only list of the integrations ACTIVE for this tenant:
// those with a published config, whether the tenant's own overlay or an inherited
// platform (GLOBAL) one. Each row links to the detail page that visualizes the
// active config's mapping + rules.
//
// Built-in code baselines (published: false) are deliberately excluded — they are
// reference material, not something this tenant runs, and showing them here read
// as "your integration is broken". The full catalog, including built-ins and the
// fork/delete actions, lives at Settings → Developer → Integrations.
// ---------------------------------------------------------------------------

export function IntegrationsIndexPage() {
  const { data, isLoading, isError } = useQuery(integrationsQueryOptions)
  const integrations = (data ?? []).filter((it) => it.published)

  return (
    <div>
      <PageHeader title="Integrations" breadcrumbs={[{ label: 'Integrations' }]} />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading integrations…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={14} className="shrink-0" />
              Failed to load integrations.
            </div>
          ) : integrations.length === 0 ? (
            <EmptyState
              title="No active integrations"
              description="Nothing is published for this tenant yet. A tenant admin can fork a platform integration under Settings → Developer → Integrations."
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {integrations.map((it) => (
                <li key={it.id}>
                  <Link
                    to="/integrations/$integrationId"
                    params={{ integrationId: it.id }}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <Blocks size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{it.name}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {it.id}
                        </Badge>
                        {/* Every row here is published — the list is filtered. */}
                        <Badge variant="secondary" className="text-xs">
                          v{it.version}
                          {it.visibility
                            ? ` · ${it.visibility === 'TENANT' ? 'Your config' : 'Platform'}`
                            : ''}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{it.description}</p>
                    </div>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
