import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { WorkflowExecutionStatusBadge } from '@/components/StatusBadge'
import { MermaidDiagram } from '@/components/MermaidDiagram'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermissions } from '@/auth/permissions'
import {
  executionHistoryQueryOptions,
  executionsQueryOptions,
  triggersQueryOptions,
  useCancelExecution,
  useRetryExecution,
  workflowQueryOptions,
} from '@/api/queries/workflows'
import type { Workflow, WorkflowExecution, WorkflowTrigger } from '@/api/workflows'

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING'])
const RETRYABLE_STATUSES = new Set(['FAILED', 'TIMED_OUT', 'CANCELLED'])

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string }
  const { data: workflow, isLoading, isError } = useQuery(workflowQueryOptions(workflowId))

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-8">
        <p className="text-muted-foreground text-sm">Loading workflow…</p>
      </div>
    )
  }

  if (isError || !workflow) {
    return (
      <div className="container mx-auto max-w-4xl py-8">
        <EmptyState
          title="Workflow not found"
          description="It may have been removed, or you don't have access."
        />
        <BackLink />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <PageHeader
        title={workflow.name}
        breadcrumbs={[{ label: 'Workflows' }, { label: workflow.name }]}
        action={
          <Badge variant="outline" className="font-mono">
            v{workflow.version}
          </Badge>
        }
      />
      <BackLink />

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="executions">Executions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <OverviewTab workflowId={workflowId} workflow={workflow} />
        </TabsContent>

        <TabsContent value="executions" className="mt-6">
          <ExecutionsTab workflowId={workflowId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/settings/workflows"
      className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
    >
      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
      Back to workflows
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Overview — diagram (author-declared) + verified envelope (platform-guaranteed)
// ---------------------------------------------------------------------------

function OverviewTab({ workflowId, workflow }: { workflowId: string; workflow: Workflow }) {
  const { data: triggers = [] } = useQuery(triggersQueryOptions(workflowId))
  const diagram = workflow.manifest.diagram
  const requiredActions = workflow.manifest.requiredActions ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Workflow diagram</CardTitle>
          <CardDescription>
            Author-declared flowchart of what this workflow does. {workflow.manifest.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {diagram ? (
            <MermaidDiagram chart={diagram} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No diagram was published with this workflow. Re-publish with the latest SDK (
              <code>pegasus-workflows diagram</code>) to add one.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verified envelope</CardTitle>
          <CardDescription>
            What the platform guarantees about this workflow, independent of the diagram.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section>
            <h4 className="mb-2 flex items-center text-sm font-medium">
              <Webhook className="text-muted-foreground mr-1.5 h-4 w-4" />
              Triggers
            </h4>
            {triggers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No triggers — this workflow only runs when started manually.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {triggers.map((t) => (
                  <li key={t.id} className="text-sm">
                    <TriggerSummary trigger={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Separator />

          <section>
            <h4 className="mb-2 flex items-center text-sm font-medium">
              <ShieldCheck className="text-muted-foreground mr-1.5 h-4 w-4" />
              Permitted actions
            </h4>
            {requiredActions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This workflow declared no platform actions — it cannot read or write tenant data.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {requiredActions.map((a) => (
                  <Badge key={a} variant="secondary" className="font-mono text-xs">
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </>
  )
}

function TriggerSummary({ trigger }: { trigger: WorkflowTrigger }) {
  if (trigger.kind === 'SCHEDULE') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Calendar className="text-muted-foreground h-3.5 w-3.5" />
        <Badge variant="outline" className="text-xs">
          Schedule
        </Badge>
        <code className="text-xs">{trigger.cronExpression}</code> (UTC)
        {!trigger.enabled && <span className="text-muted-foreground">— disabled</span>}
      </span>
    )
  }
  const filter = trigger.filter && Object.keys(trigger.filter).length > 0 ? trigger.filter : null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Webhook className="text-muted-foreground h-3.5 w-3.5" />
      <Badge variant="info" className="text-xs">
        Event
      </Badge>
      <code className="text-xs">{trigger.eventType}</code>
      {filter && (
        <span className="text-muted-foreground text-xs">where {JSON.stringify(filter)}</span>
      )}
      {!trigger.enabled && <span className="text-muted-foreground text-xs">— disabled</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Executions — list + per-row event-history timeline + cancel/retry
// ---------------------------------------------------------------------------

function ExecutionsTab({ workflowId }: { workflowId: string }) {
  const { data, isLoading } = useQuery(executionsQueryOptions(workflowId))
  const rows = data?.data ?? []

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading executions…</p>
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No executions yet"
        description="Run this workflow, or wait for a trigger to fire one."
      />
    )
  }

  return (
    <ul className="space-y-2">
      {rows.map((exec) => (
        <ExecutionRow key={exec.id} workflowId={workflowId} execution={exec} />
      ))}
    </ul>
  )
}

function ExecutionRow({
  workflowId,
  execution,
}: {
  workflowId: string
  execution: WorkflowExecution
}) {
  const [open, setOpen] = useState(false)
  const perms = usePermissions()
  const cancel = useCancelExecution()
  const retry = useRetryExecution()

  const canCancel = ACTIVE_STATUSES.has(execution.status) && perms.has('workflow:cancel_execution')
  const canRetry = RETRYABLE_STATUSES.has(execution.status) && perms.has('workflow:retry_execution')

  return (
    <li className="rounded-md border">
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
          )}
          <WorkflowExecutionStatusBadge status={execution.status} />
          <Badge variant="muted" className="text-xs">
            {execution.triggerSource}
          </Badge>
          <span className="text-muted-foreground truncate text-xs">
            {new Date(execution.queuedAt).toLocaleString()}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: workflowId, executionId: execution.id })}
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {canRetry && (
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate({ id: workflowId, executionId: execution.id })}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t p-3">
          <ExecutionDetail workflowId={workflowId} execution={execution} />
        </div>
      )}
    </li>
  )
}

function ExecutionDetail({
  workflowId,
  execution,
}: {
  workflowId: string
  execution: WorkflowExecution
}) {
  const { data: events = [], isLoading } = useQuery(
    executionHistoryQueryOptions(workflowId, execution.id),
  )

  return (
    <div className="space-y-3 text-sm">
      {execution.errorMessage && (
        <p className="text-destructive">
          <span className="font-medium">Error:</span> {execution.errorMessage}
        </p>
      )}
      <div className="text-muted-foreground grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        <span>
          Started: {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '—'}
        </span>
        <span>
          Finished: {execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : '—'}
        </span>
      </div>

      <div>
        <h5 className="mb-1.5 text-xs font-medium">Timeline</h5>
        {isLoading ? (
          <p className="text-muted-foreground text-xs">Loading timeline…</p>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No Temporal history — the run never started on Temporal.
          </p>
        ) : (
          <ol className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="text-muted-foreground font-mono">
                  {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—'}
                </span>
                <span className="font-medium">{e.type}</span>
                {e.activityType && <code className="text-muted-foreground">{e.activityType}</code>}
                {e.failure && <span className="text-destructive">{e.failure}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
