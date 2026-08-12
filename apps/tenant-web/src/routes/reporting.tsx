// ---------------------------------------------------------------------------
// /reporting — pick a dashboard, render it, set it as your default.
//
// Resolution order, all of it silent-fallback by design:
//   1. ?dashboard=<slug> in the URL (so a link is shareable);
//   2. the user's own `defaultDashboardSlug` preference;
//   3. the first dashboard the tenant can see;
//   4. the built-in.
//
// A dangling preference (archived dashboard, withdrawn fork) must NEVER surface
// as an error — the user did nothing wrong, and a dashboard that errors on load
// is indistinguishable from the whole feature being broken.
//
// The render path itself is unchanged from phase 1 apart from swapping the CSS
// grid for <DashboardGrid>: same one batched query, same per-slot degradation,
// same <ChartCard>.
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Star, StarOff, GitFork } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  dashboardDataQueryOptions,
  dashboardKeys,
  dashboardsQueryOptions,
  forkDashboard,
  reportingCatalogQueryOptions,
  setDefaultDashboard,
  userPreferencesQueryOptions,
  type DashboardSummary,
  type ReportingColumn,
} from '@/api/queries/reporting'
import {
  parseDashboardDefinition,
  type DashboardDefinition,
} from '@/features/reporting/dashboard-definition'
import {
  BUILTIN_DASHBOARD,
  BUILTIN_SLUG,
  BUILTIN_TITLE,
} from '@/features/reporting/builtin-dashboard'
import { ChartCard } from '@/features/reporting/ChartCard'
import { DashboardGrid } from '@/features/reporting/DashboardGrid'
import { usePermissions } from '@/auth/permissions'

interface Resolved {
  slug: string
  title: string
  definition: DashboardDefinition
  summary: DashboardSummary | undefined
}

export function ReportingPage() {
  const search = useSearch({ strict: false }) as { dashboard?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const perms = usePermissions()

  const catalog = useQuery(reportingCatalogQueryOptions())
  const dashboards = useQuery(dashboardsQueryOptions())
  const preferences = useQuery(userPreferencesQueryOptions())

  const available = dashboards.data?.dashboards ?? []
  const defaultSlug = preferences.data?.reporting?.defaultDashboardSlug ?? null

  const resolved = useMemo<Resolved>(() => {
    const pick =
      available.find((d) => d.slug === search.dashboard) ??
      available.find((d) => d.slug === defaultSlug) ??
      available[0]

    if (pick) {
      try {
        return {
          slug: pick.slug,
          title: pick.title,
          definition: parseDashboardDefinition(pick.definition),
          summary: pick,
        }
      } catch {
        // A stored document this client cannot parse (e.g. written by a newer
        // deploy) falls back rather than blanking the page.
      }
    }
    return {
      slug: BUILTIN_SLUG,
      title: BUILTIN_TITLE,
      definition: BUILTIN_DASHBOARD,
      summary: undefined,
    }
  }, [available, defaultSlug, search.dashboard])

  const data = useQuery(dashboardDataQueryOptions(resolved.slug, resolved.definition))

  const columnsByDataset = new Map<string, ReportingColumn[]>(
    (catalog.data?.datasets ?? []).map((d) => [d.id, d.columns]),
  )
  // Results are matched to widgets POSITIONALLY — two widgets may share a
  // dataset with different params, and a map by datasetId would collapse them.
  const results = data.data?.results ?? []

  const isDefault = defaultSlug === resolved.slug

  const setDefault = useMutation({
    mutationFn: (slug: string | null) => setDefaultDashboard(slug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.preferences() }),
  })

  const fork = useMutation({
    mutationFn: (slug: string) => forkDashboard(slug),
    onSuccess: async (forked) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
      navigate({ to: '/reporting', search: { dashboard: forked.slug } })
    },
  })

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

  const canManage = perms.has('dashboard:manage')

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {available.length > 0 ? (
            <select
              aria-label="Dashboard"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium"
              value={resolved.slug}
              onChange={(e) =>
                navigate({ to: '/reporting', search: { dashboard: e.target.value } })
              }
            >
              {available.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.title}
                  {d.visibility === 'GLOBAL' ? ' (shared)' : ''}
                </option>
              ))}
              {!available.some((d) => d.slug === BUILTIN_SLUG) ? (
                <option value={BUILTIN_SLUG}>{BUILTIN_TITLE} (built-in)</option>
              ) : null}
            </select>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{resolved.title}</h1>
          )}

          <button
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setDefault.mutate(isDefault ? null : resolved.slug)}
            disabled={setDefault.isPending}
            aria-pressed={isDefault}
          >
            {isDefault ? (
              <>
                <Star className="h-4 w-4 fill-current" /> My default
              </>
            ) : (
              <>
                <StarOff className="h-4 w-4" /> Set as my default
              </>
            )}
          </button>
        </div>

        {canManage ? (
          <div className="flex items-center gap-2">
            {resolved.summary?.forkable ? (
              <Button
                variant="outline"
                onClick={() => fork.mutate(resolved.slug)}
                disabled={fork.isPending}
              >
                <GitFork className="mr-1 h-4 w-4" />
                Fork to my tenant
              </Button>
            ) : (
              <Link to="/reporting/edit/$slug" params={{ slug: resolved.slug }}>
                <Button variant="outline">
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit
                </Button>
              </Link>
            )}
            <Link to="/reporting/new">
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                New
              </Button>
            </Link>
          </div>
        ) : null}
      </div>

      {resolved.summary?.forkable ? (
        <p className="mb-4 text-sm text-muted-foreground">
          This is a shared dashboard published for every tenant. Fork it to make your own edits —
          your copy will then take its place here.
        </p>
      ) : null}

      <DashboardGrid
        widgets={resolved.definition.widgets}
        renderWidget={(widget, i) => (
          <ChartCard
            widget={widget}
            result={results[i]}
            columns={columnsByDataset.get(widget.datasetId)}
            isLoading={data.isPending || catalog.isPending}
          />
        )}
      />
    </div>
  )
}
