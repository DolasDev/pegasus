import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  RotateCcw,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { DryRunBadge } from '@/components/DryRunBadge'
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
  useRunWorkflow,
  workflowQueryOptions,
} from '@/api/queries/workflows'
import {
  asDryRunResult,
  type DryRunCapture,
  type Workflow,
  type WorkflowExecution,
  type WorkflowTrigger,
} from '@/api/workflows'

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING'])
const RETRYABLE_STATUSES = new Set(['FAILED', 'TIMED_OUT', 'CANCELLED'])

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string }
  const { tab } = useSearch({ strict: false }) as { tab?: 'executions' }
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

      <Tabs defaultValue={tab === 'executions' ? 'executions' : 'overview'} className="mt-6">
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
  const runTest = useRunWorkflow()

  const canCancel = ACTIVE_STATUSES.has(execution.status) && perms.has('workflow:cancel_execution')
  const canRetry = RETRYABLE_STATUSES.has(execution.status) && perms.has('workflow:retry_execution')
  // "Re-run as test" replays this execution's input as a dry run — the spec's
  // replay-a-past-event affordance, nothing performed.
  const canReTest = !ACTIVE_STATUSES.has(execution.status) && perms.has('workflow:run')

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
          {execution.dryRun && <DryRunBadge />}
          <span className="text-muted-foreground truncate text-xs">
            {new Date(execution.queuedAt).toLocaleString()}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {canReTest && (
            <Button
              size="sm"
              variant="outline"
              disabled={runTest.isPending}
              title="Replay this run's input as a dry run — nothing performed"
              onClick={() =>
                runTest.mutate({ id: workflowId, input: execution.input, dryRun: true })
              }
            >
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              Re-run as test
            </Button>
          )}
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
  const dryRun = execution.dryRun ? asDryRunResult(execution.result) : null

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

      {execution.dryRun ? (
        <DryRunTrace execution={execution} result={dryRun} />
      ) : (
        <ExecutionTimeline workflowId={workflowId} executionId={execution.id} />
      )}
    </div>
  )
}

function ExecutionTimeline({
  workflowId,
  executionId,
}: {
  workflowId: string
  executionId: string
}) {
  const { data: events = [], isLoading } = useQuery(
    executionHistoryQueryOptions(workflowId, executionId),
  )
  return (
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
  )
}

// ---------------------------------------------------------------------------
// Dry-run trace — what a test run did (real reads) and what it WOULD have done
// (captured side effects), in a form a non-technical operator can read.
// ---------------------------------------------------------------------------

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  )
}

/** A `map_to_external` result carries a validation verdict; surface it if so. */
function mapVerdict(
  result: unknown,
): { valid: boolean; issues: unknown[]; degraded: boolean } | null {
  if (result != null && typeof result === 'object' && 'external' in result && 'valid' in result) {
    const r = result as { valid?: boolean; issues?: unknown[]; degraded?: boolean }
    return { valid: r.valid === true, issues: r.issues ?? [], degraded: r.degraded === true }
  }
  return null
}

function DryRunTrace({
  execution,
  result,
}: {
  execution: WorkflowExecution
  result: ReturnType<typeof asDryRunResult>
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 rounded-md bg-yellow-50 px-2.5 py-1.5 text-xs text-yellow-800">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
        This was a <span className="font-medium">test run</span>. Reads ran against live data; every
        side effect below was <span className="font-medium">captured, not performed</span>.
      </p>

      <section>
        <h5 className="mb-1 text-xs font-medium">Input</h5>
        <JsonBlock value={execution.input} />
      </section>

      {result == null ? (
        <p className="text-muted-foreground text-xs">
          No trace was recorded — the test run produced no structured result.
        </p>
      ) : (
        <>
          <section>
            <h5 className="mb-1 text-xs font-medium">Activities ({result.trace.length})</h5>
            {result.trace.length === 0 ? (
              <p className="text-muted-foreground text-xs">No activities ran.</p>
            ) : (
              <ol className="space-y-2">
                {result.trace.map((t, i) => {
                  const verdict = mapVerdict(t.result)
                  return (
                    <li key={i} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {i + 1}.
                        </span>
                        <code className="text-xs font-medium">{t.activity}</code>
                        {verdict && (
                          <Badge
                            variant={verdict.valid ? 'success' : 'warning'}
                            className="text-xs"
                          >
                            {verdict.degraded
                              ? 'mapping degraded'
                              : verdict.valid
                                ? 'mapping valid'
                                : `${verdict.issues.length} issue(s)`}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground text-[11px]">args</span>
                          <JsonBlock value={t.args} />
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px]">result</span>
                          <JsonBlock value={t.result} />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section>
            <h5 className="mb-1 text-xs font-medium">
              Would-be side effects ({result.captured.length})
            </h5>
            {result.captured.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                Nothing to perform — this run had no side effects.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {result.captured.map((c, i) => (
                  <li key={i} className="rounded-md border border-yellow-200 bg-yellow-50/50 p-2">
                    <p className="text-xs font-medium text-yellow-900">{describeCapture(c)}</p>
                    <JsonBlock value={c.payload ?? c.args ?? {}} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h5 className="mb-1 text-xs font-medium">Result</h5>
            <JsonBlock value={result.return} />
          </section>
        </>
      )}
    </div>
  )
}

/** Phrase a captured side effect for a non-technical operator. */
function describeCapture(c: DryRunCapture): string {
  const a = (c.args ?? {}) as Record<string, unknown>
  switch (c.method) {
    case 'send_sms':
      return `Would send an SMS to ${String(a['to'] ?? '?')}: “${String(a['body'] ?? '')}”`
    case 'emit_event':
      return `Would emit the event “${String(a['name'] ?? '?')}”`
    case 'close_task':
      return `Would close the “${String(a['task_type'] ?? '?')}” task on order ${String(a['order_id'] ?? '?')}`
    case 'deliver_to_external':
      return `Would deliver a body to the “${String(a['integration_id'] ?? '?')}” partner endpoint`
    case 'put_projection':
      return `Would write the ${String(a['entity_type'] ?? '?')} projection ${String(a['key'] ?? '')}`
    case 'delete_projection':
      return `Would delete the ${String(a['entity_type'] ?? '?')} projection ${String(a['key'] ?? '')}`
    case 'record_side_effect':
      return `Would ${String(c.label ?? 'perform a side effect')}`
    default:
      return `Would perform ${c.capability} (${c.method})`
  }
}
