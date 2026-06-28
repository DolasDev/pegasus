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
// All-user (non-admin) read-only list of the integration-validator integrations
// the platform checks inbound orders against. Each row links to the detail page
// that visualizes the active config's mapping + rules. The admin Developer page
// hosts a compact twin of this list (settings.developer.tsx IntegrationsCard).
// ---------------------------------------------------------------------------

export function IntegrationsIndexPage() {
  const { data, isLoading, isError } = useQuery(integrationsQueryOptions)
  const integrations = data ?? []

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
              title="No integrations"
              description="The platform team hasn't published any integrations yet."
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
                        {it.published ? (
                          <Badge variant="secondary" className="text-xs">
                            Published v{it.version}
                            {it.visibility ? ` · ${it.visibility}` : ''}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Built-in</span>
                        )}
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
