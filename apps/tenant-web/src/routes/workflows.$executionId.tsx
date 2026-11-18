import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  OctagonX,
  Radio,
  RefreshCw,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { WorkflowExecutionStatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  useCancelWorkflowInstance,
  useTerminateWorkflowInstance,
  workflowInstanceHistoryQueryOptions,
  workflowInstanceQueryOptions,
  workflowInstanceStepsQueryOptions,
} from '@/api/queries/workflow-executions'
import type { WorkflowInstanceDetail } from '@/api/workflow-executions'
import { usePermissions } from '@/auth/permissions'
import { useWorkflowQuery, type WorkflowQueryState } from '@/features/workflows/use-workflow-query'

// ---------------------------------------------------------------------------
// Workflow instance — /workflows/$executionId
//
// One durable Workflow instance, by execution id alone (its instances span
// every version, and a step knows its parent only by id).
//
//   - Header: name@version, key, stored status, timings, error, run input.
//   - Live status: the version's `status` @workflow.query, run ONCE when the
//     page opens and again on Refresh — never on a timer, because each query
//     wakes the tenant's runner. Needs workflow:query_execution (developer /
//     admin); viewers get a one-line hint instead.
//   - Delivered signals, from the Temporal history.
//   - Steps: the Automations its run_automation() calls started.
//   - Cancel / Terminate: permission-gated, hidden for viewers.
//
// The stored row is re-read every 15 s while it is open (a DB read) so the page
// notices when the instance closes.
// ---------------------------------------------------------------------------

const STATUS_QUERY = 'status'

function fmt(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

const isOpen = (row: WorkflowInstanceDetail) => row.status === 'QUEUED' || row.status === 'RUNNING'

export function WorkflowInstancePage() {
  const { executionId } = useParams({ strict: false }) as { executionId: string }
  const {
    data: row,
    isPending,
    isError,
    error,
  } = useQuery(workflowInstanceQueryOptions(executionId))

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <PageHeader
        title={row ? `${row.workflowName ?? '(deleted)'}` : 'Workflow'}
        breadcrumbs={[{ label: 'Workflows', href: '/workflows' }, { label: executionId }]}
      />
      <Link
        to="/workflows"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All Workflows
      </Link>

      {isPending ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error instanceof Error ? error.message : 'Failed to load this Workflow.'}</span>
        </div>
      ) : (
        <div className="space-y-6">
          <HeaderCard row={row} />
          <StatusPanel row={row} />
          <SignalsCard row={row} />
          <StepsCard executionId={row.id} />
          <ActionsCard row={row} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function HeaderCard({ row }: { row: WorkflowInstanceDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <WorkflowIcon className="h-4 w-4" />
          <span>{row.workflowName ?? '(deleted)'}</span>
          {row.workflowVersion && (
            <Badge variant="outline" className="font-mono text-xs">
              v{row.workflowVersion}
            </Badge>
          )}
          <WorkflowExecutionStatusBadge status={row.status} />
          {row.kind === 'AUTOMATION' && <Badge variant="muted">Automation</Badge>}
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            Key:{' '}
            {row.correlationKey ? (
              <span className="font-mono text-foreground">{row.correlationKey}</span>
            ) : (
              'manual run'
            )}
          </span>
          <span className="block font-mono text-xs">{row.id}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
          <span>Queued: {fmt(row.queuedAt)}</span>
          <span>Started: {fmt(row.startedAt)}</span>
          <span>Finished: {fmt(row.finishedAt)}</span>
        </div>
        {row.errorMessage && (
          <p className="text-destructive">
            <span className="font-medium">Error:</span> {row.errorMessage}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Run input</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(row.input, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Live status (the @workflow.query)
// ---------------------------------------------------------------------------

function StatusPanel({ row }: { row: WorkflowInstanceDetail }) {
  const perms = usePermissions()
  const canQuery = perms.has('workflow:query_execution')
  const status = useWorkflowQuery(row.id)
  const adhoc = useWorkflowQuery(row.id)

  const queryable = isOpen(row) && row.temporalWorkflowId !== null
  const hasStatusQuery = row.queries.includes(STATUS_QUERY)
  const autoRun = canQuery && queryable && hasStatusQuery
  const runStatus = status.run

  // Once when the page opens (or the permission answer arrives) — the deps are
  // primitives, so the 15 s row re-read never re-runs it. Never on a timer.
  useEffect(() => {
    if (autoRun) runStatus(STATUS_QUERY)
  }, [autoRun, row.id, runStatus])

  if (row.kind !== 'WORKFLOW') return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Live status</span>
          {canQuery && queryable && hasStatusQuery && (
            <Button
              size="sm"
              variant="outline"
              disabled={status.state.status === 'running'}
              onClick={() => runStatus(STATUS_QUERY)}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Asks the running Workflow where it stands. Each ask wakes your tenant&rsquo;s runner, so
          it runs when you open the page or press Refresh, never on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!perms.isLoading && !canQuery ? (
          <p className="text-muted-foreground">
            Live status needs the developer role. The stored status, key, signals and steps are
            shown here.
          </p>
        ) : !queryable ? (
          <p className="text-muted-foreground">
            {isOpen(row)
              ? 'This Workflow has not started yet. Live status is available once it is running.'
              : 'This Workflow is closed. Live status is only available while it is open.'}
          </p>
        ) : (
          <>
            {hasStatusQuery ? (
              <QueryResult state={status.state} />
            ) : (
              <p className="text-muted-foreground">
                This Workflow version declares no <code className="font-mono">status</code> query.
              </p>
            )}
            {row.queries.length > 0 && <AdhocQuery queries={row.queries} query={adhoc} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function QueryResult({ state }: { state: WorkflowQueryState }) {
  if (state.status === 'idle') return null
  if (state.status === 'running') {
    return (
      <p className="flex items-center gap-2 text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        {state.waking ? 'Waking the runner… (this can take up to a minute)' : 'Asking…'}
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        {state.gaveUp
          ? 'The runner did not start in time. Try again in a minute.'
          : state.error.message}
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <pre
        className="max-h-80 overflow-auto rounded bg-muted p-2 text-xs"
        aria-label={`${state.name} result`}
      >
        {JSON.stringify(state.result, null, 2)}
      </pre>
      <p className="text-xs text-muted-foreground">As of {state.at.toLocaleTimeString()}</p>
    </div>
  )
}

function AdhocQuery({
  queries,
  query,
}: {
  queries: string[]
  query: ReturnType<typeof useWorkflowQuery>
}) {
  const [name, setName] = useState(queries[0] ?? '')
  const [argsText, setArgsText] = useState('')
  const [argsError, setArgsError] = useState<string | null>(null)

  function submit() {
    let args: unknown[] = []
    if (argsText.trim()) {
      try {
        const parsed: unknown = JSON.parse(argsText)
        if (!Array.isArray(parsed)) throw new Error('not an array')
        args = parsed
      } catch {
        setArgsError('Arguments must be a JSON array, e.g. ["o-7"]')
        return
      }
    }
    setArgsError(null)
    query.run(name, args)
  }

  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">Run another query</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="adhoc-query-name">Query</Label>
            <select
              id="adhoc-query-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {queries.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="adhoc-query-args">Arguments (JSON array, optional)</Label>
            <input
              id="adhoc-query-args"
              value={argsText}
              placeholder='["o-7"]'
              onChange={(e) => setArgsText(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-mono text-sm"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={submit}
            disabled={query.state.status === 'running'}
          >
            Run query
          </Button>
        </div>
        {argsError && (
          <p role="alert" className="text-xs text-destructive">
            {argsError}
          </p>
        )}
        <QueryResult state={query.state} />
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Delivered signals
// ---------------------------------------------------------------------------

function SignalsCard({ row }: { row: WorkflowInstanceDetail }) {
  const started = row.temporalWorkflowId !== null
  const { data, isPending, isError } = useQuery({
    ...workflowInstanceHistoryQueryOptions(row.workflowId, row.id),
    enabled: started && row.kind === 'WORKFLOW',
  })
  if (row.kind !== 'WORKFLOW') return null
  const signals = (data ?? []).filter((e) => e.type === 'WorkflowExecutionSignaled')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" /> Delivered signals
        </CardTitle>
        {row.signals.length > 0 && (
          <CardDescription>
            Accepts: <span className="font-mono">{row.signals.join(', ')}</span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {!started ? (
          <p className="text-muted-foreground">Not started yet.</p>
        ) : isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </p>
        ) : isError ? (
          <p className="text-destructive">Failed to load the history.</p>
        ) : signals.length === 0 ? (
          <p className="text-muted-foreground">No signals delivered yet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Delivered signals">
            {signals.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-mono">{s.signalName ?? '(unnamed)'}</span>
                <span className="text-xs text-muted-foreground">{fmt(s.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function StepsCard({ executionId }: { executionId: string }) {
  const { data, isPending, isError } = useQuery(workflowInstanceStepsQueryOptions(executionId))
  const steps = data?.data ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" /> Steps
        </CardTitle>
        <CardDescription>The Automations this Workflow started, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading steps…
          </p>
        ) : isError ? (
          <p className="text-destructive">Failed to load the steps.</p>
        ) : steps.length === 0 ? (
          <p className="text-muted-foreground">No steps yet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Steps">
            {steps.map((step) => (
              <li key={step.id}>
                <Link
                  to="/automations/$workflowId"
                  params={{ workflowId: step.workflowId }}
                  search={{ tab: 'executions' }}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-accent/50"
                >
                  <span className="font-medium">{step.workflowName ?? '(deleted)'}</span>
                  {step.workflowVersion && (
                    <Badge variant="outline" className="font-mono text-xs">
                      v{step.workflowVersion}
                    </Badge>
                  )}
                  <WorkflowExecutionStatusBadge status={step.status} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmt(step.queuedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Cancel / Terminate
// ---------------------------------------------------------------------------

function ActionsCard({ row }: { row: WorkflowInstanceDetail }) {
  const perms = usePermissions()
  const canCancel = perms.has('workflow:cancel_execution')
  const canTerminate = perms.has('workflow:terminate_execution')
  const cancel = useCancelWorkflowInstance()
  const terminate = useTerminateWorkflowInstance()
  const [confirming, setConfirming] = useState<'cancel' | 'terminate' | null>(null)
  const [reason, setReason] = useState('')

  if (!isOpen(row) || (!canCancel && !canTerminate)) return null
  const error = cancel.error ?? terminate.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stop this Workflow</CardTitle>
        <CardDescription>
          Cancel asks the Workflow to stop; its code can clean up. Terminate ends it at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {confirming === null && (
          <div className="flex flex-wrap gap-2">
            {canCancel && (
              <Button size="sm" variant="outline" onClick={() => setConfirming('cancel')}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancel…
              </Button>
            )}
            {canTerminate && (
              <Button size="sm" variant="destructive" onClick={() => setConfirming('terminate')}>
                <OctagonX className="mr-1.5 h-3.5 w-3.5" /> Terminate…
              </Button>
            )}
          </div>
        )}

        {confirming === 'cancel' && (
          <div className="space-y-2 rounded-md border p-3" role="group" aria-label="Confirm cancel">
            <p>
              Ask this Workflow to cancel? It decides what to do, and the status updates once it has
              stopped.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(row.id, { onSuccess: () => setConfirming(null) })}
              >
                Cancel Workflow
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Keep running
              </Button>
            </div>
          </div>
        )}

        {confirming === 'terminate' && (
          <form
            className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3"
            aria-label="Confirm terminate"
            onSubmit={(e) => {
              e.preventDefault()
              if (!reason.trim()) return
              terminate.mutate(
                { executionId: row.id, reason: reason.trim() },
                { onSuccess: () => setConfirming(null) },
              )
            }}
          >
            <p className="text-destructive">
              Terminate ends this Workflow now: no more of its code runs, and its open steps are
              cancelled. This cannot be undone.
            </p>
            <Label htmlFor="terminate-reason">Reason (required)</Label>
            <textarea
              id="terminate-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              className="block w-full rounded-md border border-input bg-background p-2 text-sm"
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={!reason.trim() || terminate.isPending}
              >
                Terminate Workflow
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Back
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-destructive">
            {error instanceof Error ? error.message : 'The request failed.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
