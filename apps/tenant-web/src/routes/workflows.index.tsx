import { useState, type FormEvent } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ChevronRight, Loader2, Workflow as WorkflowIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { WorkflowExecutionStatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { workflowInstancesInfiniteQueryOptions } from '@/api/queries/workflow-executions'
import type { WorkflowInstance } from '@/api/workflow-executions'

// ---------------------------------------------------------------------------
// Workflows — /workflows
//
// The tenant's durable (long-running) Workflow instances, e.g. one per order,
// keyed by the order id. Open instances by default, newest first, across every
// version. Each row opens /workflows/$executionId (status, delivered signals,
// steps, cancel / terminate). Readable by every AUTOMATION_VIEW_ROLES holder;
// the actions on the detail page are permission-gated.
//
// A cheap DB read, so it may refetch on window focus. It never runs a
// @workflow.query (that wakes the tenant's runner).
// ---------------------------------------------------------------------------

type Filters = { name: string; correlationKey: string; openOnly: boolean }

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

export function WorkflowsIndexPage() {
  const [draft, setDraft] = useState<Filters>({ name: '', correlationKey: '', openOnly: true })
  const [applied, setApplied] = useState<Filters>(draft)

  const name = applied.name.trim()
  const key = applied.correlationKey.trim()
  const query = useInfiniteQuery(
    workflowInstancesInfiniteQueryOptions({
      openOnly: applied.openOnly,
      ...(name ? { name } : {}),
      ...(name && key ? { correlationKey: key } : {}),
    }),
  )
  const rows = query.data?.pages.flatMap((p) => p.data) ?? []

  function apply(e: FormEvent) {
    e.preventDefault()
    setApplied(draft)
  }

  function setOpenOnly(openOnly: boolean) {
    const next = { ...draft, openOnly }
    setDraft(next)
    setApplied({ ...applied, openOnly })
  }

  return (
    <div>
      <PageHeader title="Workflows" breadcrumbs={[{ label: 'Workflows' }]} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">
            Long-running Workflows wait on events, timers and signals, often one per order. Open one
            to see where it stands, what has been delivered to it, and the Automations it started.
            Short one-shot runs are under{' '}
            <Link to="/automations" className="text-primary hover:underline">
              Automations
            </Link>
            .
          </p>

          <form onSubmit={apply} className="flex flex-wrap items-end gap-3" aria-label="Filters">
            <div className="space-y-1">
              <Label htmlFor="wf-filter-name">Workflow name</Label>
              <Input
                id="wf-filter-name"
                value={draft.name}
                placeholder="order_lifecycle"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-56"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wf-filter-key">Key</Label>
              <Input
                id="wf-filter-key"
                value={draft.correlationKey}
                placeholder="e.g. an order id"
                disabled={!draft.name.trim()}
                title={draft.name.trim() ? undefined : 'Enter a Workflow name to search by key'}
                onChange={(e) => setDraft({ ...draft, correlationKey: e.target.value })}
                className="w-48"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
            <div className="ml-auto flex rounded-md border" role="group" aria-label="Show">
              <Button
                type="button"
                size="sm"
                variant={applied.openOnly ? 'secondary' : 'ghost'}
                aria-pressed={applied.openOnly}
                onClick={() => setOpenOnly(true)}
              >
                Open
              </Button>
              <Button
                type="button"
                size="sm"
                variant={applied.openOnly ? 'ghost' : 'secondary'}
                aria-pressed={!applied.openOnly}
                onClick={() => setOpenOnly(false)}
              >
                All
              </Button>
            </div>
          </form>

          {query.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading Workflows…
            </div>
          ) : query.isError ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle size={14} className="shrink-0" />
              {query.error instanceof Error ? query.error.message : 'Failed to load Workflows.'}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={applied.openOnly ? 'No open Workflows' : 'No Workflows'}
              description={
                applied.openOnly
                  ? 'Nothing is running right now. A Workflow appears here once an event or a manual run starts one.'
                  : 'No Workflow has run in this tenant with these filters.'
              }
            />
          ) : (
            <>
              <ul className="divide-y rounded-md border">
                {rows.map((row) => (
                  <InstanceRow key={row.id} row={row} />
                ))}
              </ul>
              {query.hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InstanceRow({ row }: { row: WorkflowInstance }) {
  return (
    <li>
      <Link
        to="/workflows/$executionId"
        params={{ executionId: row.id }}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
      >
        <WorkflowIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{row.workflowName ?? '(deleted)'}</span>
            {row.workflowVersion && (
              <Badge variant="outline" className="font-mono text-xs">
                v{row.workflowVersion}
              </Badge>
            )}
            <WorkflowExecutionStatusBadge status={row.status} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Key:{' '}
              {row.correlationKey ? (
                <span className="font-mono text-foreground">{row.correlationKey}</span>
              ) : (
                'manual'
              )}
            </span>
            <span>Started: {fmt(row.startedAt ?? row.queuedAt)}</span>
            <span>Last change: {fmt(row.finishedAt ?? row.updatedAt)}</span>
          </div>
        </div>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}
