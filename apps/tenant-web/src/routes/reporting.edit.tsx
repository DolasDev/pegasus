// ---------------------------------------------------------------------------
// /reporting/edit/$slug — the drag-and-drop dashboard editor.
//
// Geometry comes from the SAME <DashboardGrid> the viewer uses, so what you drag
// is literally what renders. Live data is deliberately NOT fetched here: the
// editor shows each widget's identity and settings, not its numbers. Fetching
// on every drag would multiply requests into the Lambda concurrency cap for no
// design benefit, and a chart mid-resize tells you nothing a label doesn't.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Layout } from 'react-grid-layout'
import { GripVertical, Plus, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  dashboardKeys,
  dashboardsQueryOptions,
  publishDashboard,
  reportingCatalogQueryOptions,
  type ReportingDataset,
} from '@/api/queries/reporting'
import {
  DEFAULT_WIDGET_H,
  GRID_COLUMNS,
  MAX_WIDGETS,
  nextFreeRow,
  parseDashboardDefinition,
  type DashboardWidget,
} from '@/features/reporting/dashboard-definition'
import {
  BUILTIN_DASHBOARD,
  BUILTIN_SLUG,
  BUILTIN_TITLE,
} from '@/features/reporting/builtin-dashboard'
import { DashboardGrid } from '@/features/reporting/DashboardGrid'
import { WidgetSettings } from '@/features/reporting/WidgetSettings'

/** A slug derived from the title, for a brand-new dashboard. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

/**
 * Disambiguate a NEW dashboard's slug against the ones already visible.
 *
 * Publishing to an existing slug is a new VERSION of that lineage — correct when
 * editing, catastrophic when creating: titling a new dashboard "Operations
 * overview" would otherwise supersede the team's existing one, and everybody
 * whose default points at that slug would silently start seeing different
 * content. (The old version survives as SUPERSEDED, so it is a visibility
 * accident rather than data loss — but nobody would know to go looking.)
 *
 * Only applies on create. Editing an existing slug must keep publishing into
 * that lineage, which is the whole point of versioning.
 */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  if (!base) return base
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`.slice(0, 128)
    if (!used.has(candidate)) return candidate
  }
  return base
}

export function ReportingEditPage() {
  const params = useParams({ strict: false }) as { slug?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const catalog = useQuery(reportingCatalogQueryOptions())
  const dashboards = useQuery(dashboardsQueryOptions())

  const datasets = useMemo(() => catalog.data?.datasets ?? [], [catalog.data])
  const byId = useMemo(
    () => new Map<string, ReportingDataset>(datasets.map((d) => [d.id, d])),
    [datasets],
  )

  // What to start from:
  //   - an existing stored dashboard being edited;
  //   - the built-in, when editing the built-in slug (the "customize the
  //     default one" path, which is how most tenants will get their first);
  //   - an empty canvas for anything else.
  // A stored document that fails to parse must not brick the editor — it falls
  // back to empty and lets the user re-author rather than showing a dead page.
  const seed = useMemo(() => {
    const existing = dashboards.data?.dashboards.find((d) => d.slug === params.slug)
    if (existing) {
      try {
        return {
          title: existing.title,
          widgets: parseDashboardDefinition(existing.definition).widgets,
        }
      } catch {
        return { title: existing.title, widgets: [] as DashboardWidget[] }
      }
    }
    if (params.slug === BUILTIN_SLUG) {
      return { title: BUILTIN_TITLE, widgets: [...BUILTIN_DASHBOARD.widgets] }
    }
    return { title: 'Untitled dashboard', widgets: [] as DashboardWidget[] }
  }, [dashboards.data, params.slug])

  const [draft, setDraft] = useState<{ title: string; widgets: DashboardWidget[] } | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The first render happens before the dashboards query resolves, so the draft
  // is adopted from the seed once — and only once, so a background refetch can
  // never clobber unsaved edits.
  const isReady = !params.slug || params.slug === BUILTIN_SLUG || dashboards.isFetched
  if (draft === null && isReady) {
    setDraft({ title: seed.title, widgets: [...seed.widgets] })
  }

  const title = draft?.title ?? seed.title
  const widgets = draft?.widgets ?? []
  const setTitle = (next: string) => setDraft((d) => ({ ...(d ?? seed), title: next }))
  const setWidgets = (fn: (current: DashboardWidget[]) => DashboardWidget[]) =>
    setDraft((d) => {
      const base = d ?? { title: seed.title, widgets: [...seed.widgets] }
      return { ...base, widgets: fn(base.widgets) }
    })

  const publish = useMutation({
    mutationFn: publishDashboard,
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
      navigate({ to: '/reporting', search: { dashboard: saved.slug } })
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Publish failed'),
  })

  function applyLayout(next: Layout) {
    setWidgets((current) =>
      current.map((w, i) => {
        const l = next.find((item) => item.i === String(i))
        return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w
      }),
    )
  }

  function addWidget(dataset: ReportingDataset) {
    setWidgets((current) => [
      ...current,
      {
        datasetId: dataset.id,
        datasetVersion: dataset.version,
        widget: dataset.columns.length <= 1 ? 'scalar' : 'bar',
        title: dataset.title,
        span: 2,
        layout: { x: 0, y: nextFreeRow(current), w: GRID_COLUMNS / 2, h: DEFAULT_WIDGET_H },
      },
    ])
    setAdding(false)
  }

  function onPublish() {
    setError(null)
    // Editing keeps the existing slug (publish = a new version of that lineage).
    // Creating disambiguates, so a colliding title cannot supersede someone
    // else's dashboard — see uniqueSlug.
    const slug = params.slug
      ? params.slug
      : uniqueSlug(
          slugify(title),
          (dashboards.data?.dashboards ?? []).map((d) => d.slug),
        )
    if (!slug) {
      setError('Give the dashboard a title first.')
      return
    }
    if (widgets.length === 0) {
      setError('Add at least one widget.')
      return
    }
    publish.mutate({ slug, title, definition: { schemaVersion: 2, widgets } })
  }

  const atCapacity = widgets.length >= MAX_WIDGETS

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <input
            aria-label="Dashboard title"
            className="w-72 rounded-md border border-input bg-background px-3 py-1.5 text-lg font-semibold"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Drag a card by its handle to move it, or drag its corner to resize.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAdding(true)} disabled={atCapacity}>
            <Plus className="mr-1 h-4 w-4" />
            Add widget
          </Button>
          <Button variant="ghost" onClick={() => navigate({ to: '/reporting' })}>
            Cancel
          </Button>
          <Button onClick={onPublish} disabled={publish.isPending}>
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </div>

      {atCapacity ? (
        <p className="mb-3 text-sm text-muted-foreground">
          A dashboard holds at most {MAX_WIDGETS} widgets — that cap is what keeps one dashboard to
          a single batched request.
        </p>
      ) : null}

      {error ? (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {widgets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No widgets yet. Choose “Add widget” to start from the dataset catalog.
          </CardContent>
        </Card>
      ) : (
        <DashboardGrid
          widgets={widgets}
          editable
          onLayoutChange={applyLayout}
          renderWidget={(widget, i) => (
            <Card className="flex h-full flex-col" data-testid={`edit-widget-${widget.datasetId}`}>
              <CardHeader className="flex-row items-center justify-between space-y-0 py-2">
                <div className="flex min-w-0 items-center gap-1">
                  {/* Only this handle starts a drag — see DashboardGrid. */}
                  <span
                    data-grid-drag-handle
                    className="cursor-grab text-muted-foreground"
                    aria-label="Drag to move"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <CardTitle className="truncate text-sm font-medium">{widget.title}</CardTitle>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="rounded p-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => setEditingIndex(i)}
                    aria-label={`Settings for ${widget.title}`}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setWidgets((c) => c.filter((_, j) => j !== i))}
                    aria-label={`Remove ${widget.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 pb-3">
                <p className="text-xs text-muted-foreground">{widget.datasetId}</p>
                <p className="mt-1 text-xs text-muted-foreground">{widget.widget}</p>
              </CardContent>
            </Card>
          )}
        />
      )}

      {adding ? (
        <DatasetPicker datasets={datasets} onPick={addWidget} onClose={() => setAdding(false)} />
      ) : null}

      {editingIndex !== null && widgets[editingIndex] ? (
        <SettingsPanel
          widget={widgets[editingIndex]}
          dataset={byId.get(widgets[editingIndex].datasetId)}
          onChange={(next) => setWidgets((c) => c.map((w, j) => (j === editingIndex ? next : w)))}
          onClose={() => setEditingIndex(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * The add-widget drawer. Lists only datasets the CALLER can run — the catalog
 * endpoint already filters by their grants, so an author cannot build a
 * dashboard around data they cannot see.
 */
function DatasetPicker({
  datasets,
  onPick,
  onClose,
}: {
  datasets: ReportingDataset[]
  onPick: (d: ReportingDataset) => void
  onClose: () => void
}) {
  return (
    <Drawer title="Add a widget" onClose={onClose}>
      {datasets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No datasets are available to you.</p>
      ) : (
        <ul className="space-y-2">
          {datasets.map((d) => (
            <li key={d.id}>
              <button
                className="w-full rounded-md border border-border p-3 text-left hover:bg-muted"
                onClick={() => onPick(d)}
              >
                <span className="block text-sm font-medium">{d.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{d.description}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {d.source === 'legacy-mssql' ? 'Legacy system' : 'Cloud'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

function SettingsPanel({
  widget,
  dataset,
  onChange,
  onClose,
}: {
  widget: DashboardWidget
  dataset: ReportingDataset | undefined
  onChange: (next: DashboardWidget) => void
  onClose: () => void
}) {
  return (
    <Drawer title="Widget settings" onClose={onClose}>
      <WidgetSettings widget={widget} dataset={dataset} onChange={onChange} />
    </Drawer>
  )
}

/** Minimal right-hand drawer — the repo has a Dialog primitive but this is a
 *  non-modal side panel, and reusing Dialog would trap focus over the canvas. */
function Drawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 overflow-y-auto border-l border-border bg-card p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button onClick={onClose} aria-label="Close panel" className="rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  )
}
