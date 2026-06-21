import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Globe,
  Info,
  Loader2,
  Lock,
  Play,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { WorkflowExecutionStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  executionsQueryOptions,
  triggersQueryOptions,
  useCreateTrigger,
  useDeleteTrigger,
  useForkWorkflow,
  useRunWorkflow,
  useUpdateTrigger,
  workflowsQueryOptions,
} from '@/api/queries/workflows'
import {
  DOMAIN_EVENT_TYPES,
  getWorkflowDownloadUrl,
  type CreateWorkflowTriggerInput,
  type Workflow,
  type WorkflowExecution,
  type WorkflowTrigger,
  type WorkflowTriggerKind,
  type WorkflowTriggerSource,
} from '@/api/workflows'
import { ApiError } from '@/api/client'
import { usePermissions } from '@/auth/permissions'
import { formatFireTimeUtc, parseCronExpression, previewNextFires } from '@/lib/cron-preview'
import { parseTriggerFilter } from '@/lib/trigger-filter'
import { eventTypesQueryOptions } from '@/api/queries/event-types'

// Triggers are gated by this Cedar permission (underscore, not hyphen — the
// /me/permissions contract only allows [a-z_]+:[a-z_]+ strings).
const MANAGE_TRIGGERS_PERMISSION = 'workflow:manage_triggers'

// ---------------------------------------------------------------------------
// Executability helpers
// ---------------------------------------------------------------------------

/**
 * Returns the effective executability state of a workflow:
 *   'curated'       — GLOBAL platform-library workflow (runs on the shared
 *                     stdlib worker; always executable).
 *   'executable'    — TENANT-visibility workflow whose artifact passed
 *                     integrity validation (executable=true).
 *   'not-executable'— TENANT-visibility workflow that has not yet been
 *                     validated (pre-Unit-6 upload or upload that failed
 *                     validation); must be re-uploaded to become executable.
 */
function workflowExecutability(workflow: Workflow): 'curated' | 'executable' | 'not-executable' {
  if (workflow.visibility === 'GLOBAL') return 'curated'
  if (workflow.executable) return 'executable'
  return 'not-executable'
}

function ExecutabilityBadge({ workflow }: { workflow: Workflow }) {
  const state = workflowExecutability(workflow)
  if (state === 'curated') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <CheckCircle2 className="h-3 w-3" />
        Curated
      </span>
    )
  }
  if (state === 'executable') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3 w-3" />
        Executable
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
      title="This workflow has not passed artifact validation. Re-upload the artifact to enable execution."
    >
      <XCircle className="h-3 w-3" />
      Not executable
    </span>
  )
}

// ---------------------------------------------------------------------------
// Friendly run-error messages for limit / kill-switch outcomes
// ---------------------------------------------------------------------------

/** Translates an API error code or message into a friendly human string. */
function friendlyRunError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Failed to start run.'
  // Map structured error codes to specific messages (spec: Resolved #3 + Unit 11)
  if (error.code === 'CONCURRENCY_LIMIT') {
    return 'Your account has 5 concurrent executions running. Wait for one to finish before starting another.'
  }
  if (error.code === 'DAILY_QUOTA_EXCEEDED') {
    return 'Your account has reached the daily execution quota. The quota resets at midnight UTC.'
  }
  if (error.code === 'WORKFLOWS_DISABLED') {
    return 'Workflow execution is currently disabled for your account. Contact your platform administrator.'
  }
  return error.message || 'Failed to start run.'
}

// SCHEDULE rows get a purple badge; the shared Badge component has no purple
// variant, so this className mirrors its success/warning/info palette style.
const SCHEDULE_BADGE_CLASS = 'border-transparent bg-purple-100 text-purple-800'

// ---------------------------------------------------------------------------
// Trigger badges — kind on trigger rows, source on execution rows
// ---------------------------------------------------------------------------

function TriggerKindBadge({ kind }: { kind: WorkflowTriggerKind }) {
  if (kind === 'EVENT') return <Badge variant="info">Event</Badge>
  return <Badge className={SCHEDULE_BADGE_CLASS}>Schedule</Badge>
}

function TriggerSourceBadge({ source }: { source: WorkflowTriggerSource }) {
  if (source === 'EVENT') return <Badge variant="info">Event</Badge>
  if (source === 'SCHEDULE') return <Badge className={SCHEDULE_BADGE_CLASS}>Schedule</Badge>
  return <Badge variant="muted">Manual</Badge>
}

// ---------------------------------------------------------------------------
// Run dialog — collects an optional JSON input object and triggers a run
// ---------------------------------------------------------------------------

function RunWorkflowDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const [inputText, setInputText] = useState('{}')
  const [parseError, setParseError] = useState<string | null>(null)
  const runMutation = useRunWorkflow()

  let runError: string | null = null
  if (runMutation.error) {
    runError = friendlyRunError(runMutation.error)
  }

  function handleRun() {
    setParseError(null)
    let parsed: unknown
    try {
      parsed = inputText.trim() === '' ? {} : JSON.parse(inputText)
    } catch {
      setParseError('Input must be valid JSON.')
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Input must be a JSON object (e.g. {"key": "value"}).')
      return
    }
    runMutation.mutate({ id: workflow.id, input: parsed }, { onSuccess: () => onClose() })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Run ${workflow.name}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Play className="h-4 w-4" />
          Run <span className="font-mono">{workflow.name}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Provide the JSON input for this run. The shape is defined by the workflow author. Leave as{' '}
          <code className="font-mono">{'{}'}</code> if no input is required.
        </p>
        <label htmlFor="run-input" className="mt-4 block text-xs font-medium text-foreground">
          Input (JSON)
        </label>
        <textarea
          id="run-input"
          className="mt-1 h-40 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={inputText}
          spellCheck={false}
          onChange={(e) => setInputText(e.target.value)}
        />
        {parseError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {parseError}
          </p>
        )}
        {runError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {runError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={runMutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleRun} disabled={runMutation.isPending}>
            {runMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run workflow
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Executions list — recent runs for a workflow, polled while in-flight
// ---------------------------------------------------------------------------

function ExecutionResult({ execution }: { execution: WorkflowExecution }) {
  if (execution.errorMessage) {
    return (
      <p className="mt-1 break-words font-mono text-xs text-destructive">
        {execution.errorMessage}
      </p>
    )
  }
  if (execution.result != null) {
    return (
      <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {JSON.stringify(execution.result, null, 2)}
      </pre>
    )
  }
  return null
}

function ExecutionsList({ workflowId }: { workflowId: string }) {
  const { data, isPending, isError, error } = useQuery(executionsQueryOptions(workflowId))

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading executions…
      </div>
    )
  }

  if (isError) {
    return (
      <p className="py-2 text-xs text-destructive" role="alert">
        {error instanceof Error ? error.message : 'Failed to load executions.'}
      </p>
    )
  }

  const executions = data?.data ?? []
  if (executions.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No runs yet.</p>
  }

  return (
    <ul className="space-y-2 py-1">
      {executions.map((exec) => (
        <li key={exec.id} className="rounded-md border border-border bg-background px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <WorkflowExecutionStatusBadge status={exec.status} />
            <TriggerSourceBadge source={exec.triggerSource} />
            <span className="text-xs text-muted-foreground">
              Queued {new Date(exec.queuedAt).toLocaleString()}
            </span>
            {exec.finishedAt && (
              <span className="text-xs text-muted-foreground">
                · Finished {new Date(exec.finishedAt).toLocaleString()}
              </span>
            )}
          </div>
          <ExecutionResult execution={exec} />
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Create-trigger dialog — kind selector, then EVENT (event type + optional
// JSON filter) or SCHEDULE (cron expression + next-fire preview) fields
// ---------------------------------------------------------------------------

const CRON_PLACEHOLDER = '*/15 * * * *'

function CronPreview({ expression }: { expression: string }) {
  if (expression.trim() === '') return null
  const preview = previewNextFires(expression)
  if (preview.status === 'invalid') {
    return (
      <p className="mt-2 text-xs text-destructive" role="alert">
        Invalid expression.
      </p>
    )
  }
  if (preview.status === 'none') {
    return (
      <p className="mt-2 text-xs text-yellow-700" role="alert">
        This expression never fires within the next 366 days.
      </p>
    )
  }
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <p>Next fires:</p>
      <ul className="mt-0.5 space-y-0.5 font-mono">
        {preview.times.map((t) => (
          <li key={t.getTime()}>{formatFireTimeUtc(t)}</li>
        ))}
      </ul>
    </div>
  )
}

function CreateTriggerDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const [kind, setKind] = useState<WorkflowTriggerKind>('EVENT')
  const [eventType, setEventType] = useState<string>(DOMAIN_EVENT_TYPES[0])
  const [filterText, setFilterText] = useState('')
  const [cronExpression, setCronExpression] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const createMutation = useCreateTrigger()
  // Custom event types the tenant has registered — selectable alongside the
  // built-in taxonomy. Only the enabled ones can back a new trigger.
  const { data: customEventTypes } = useQuery(eventTypesQueryOptions)
  const enabledCustomTypes = (customEventTypes ?? []).filter((t) => t.enabled)

  let serverError: string | null = null
  if (createMutation.error) {
    serverError =
      createMutation.error instanceof ApiError
        ? createMutation.error.message
        : 'Failed to create trigger.'
  }

  function handleCreate() {
    setFormError(null)
    let input: CreateWorkflowTriggerInput
    if (kind === 'EVENT') {
      const validation = parseTriggerFilter(filterText)
      if (!validation.ok) {
        setFormError(validation.error)
        return
      }
      input = { kind, eventType, ...(validation.filter ? { filter: validation.filter } : {}) }
    } else {
      const expr = cronExpression.trim()
      if (parseCronExpression(expr) === null) {
        setFormError('Invalid expression.')
        return
      }
      input = { kind, cronExpression: expr }
    }
    createMutation.mutate({ workflowId: workflow.id, input }, { onSuccess: () => onClose() })
  }

  const selectClass =
    'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Add trigger to ${workflow.name}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Plus className="h-4 w-4" />
          Add trigger to <span className="font-mono">{workflow.name}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Triggers run this workflow automatically — either when a domain event fires or on a cron
          schedule.
        </p>

        <label htmlFor="trigger-kind" className="mt-4 block text-xs font-medium text-foreground">
          Kind
        </label>
        <select
          id="trigger-kind"
          className={selectClass}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as WorkflowTriggerKind)
            // Clear any validation error from the other kind's form.
            setFormError(null)
          }}
        >
          <option value="EVENT">Event — fire when a domain event occurs</option>
          <option value="SCHEDULE">Schedule — fire on a cron schedule</option>
        </select>

        {kind === 'EVENT' ? (
          <>
            <label
              htmlFor="trigger-event-type"
              className="mt-4 block text-xs font-medium text-foreground"
            >
              Event type
            </label>
            <select
              id="trigger-event-type"
              className={selectClass}
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <optgroup label="Built-in">
                {DOMAIN_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
              {enabledCustomTypes.length > 0 && (
                <optgroup label="Custom">
                  {enabledCustomTypes.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <label
              htmlFor="trigger-filter"
              className="mt-4 block text-xs font-medium text-foreground"
            >
              Filter (optional JSON)
            </label>
            <textarea
              id="trigger-filter"
              className="mt-1 h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={filterText}
              spellCheck={false}
              placeholder='{"status": "COMPLETED"} or {"path":"status","op":"eq","value":"DONE"}'
              onChange={(e) => setFilterText(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Simple form: every key must equal the same key in the payload (scalars only).
              Structured form: <code className="font-mono">{'{"path","op","value"}'}</code> with
              all/any groups. Leave empty to fire on every{' '}
              <code className="font-mono">{eventType}</code> event.
            </p>
          </>
        ) : (
          <>
            <label
              htmlFor="trigger-cron"
              className="mt-4 block text-xs font-medium text-foreground"
            >
              Cron expression
            </label>
            <input
              id="trigger-cron"
              type="text"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={cronExpression}
              spellCheck={false}
              placeholder={CRON_PLACEHOLDER}
              onChange={(e) => setCronExpression(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              5 fields (minute hour day-of-month month day-of-week), evaluated in UTC. Supports{' '}
              <code className="font-mono">*</code>, numbers, commas, ranges (
              <code className="font-mono">a-b</code>) and steps (
              <code className="font-mono">*/n</code>, <code className="font-mono">a-b/n</code>)
              only.
            </p>
            <CronPreview expression={cronExpression} />
          </>
        )}

        {formError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {formError}
          </p>
        )}
        {serverError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {serverError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Add trigger
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete-trigger confirm dialog
// ---------------------------------------------------------------------------

function DeleteTriggerDialog({
  workflowId,
  trigger,
  onClose,
}: {
  workflowId: string
  trigger: WorkflowTrigger
  onClose: () => void
}) {
  const deleteMutation = useDeleteTrigger()

  let deleteError: string | null = null
  if (deleteMutation.error) {
    deleteError =
      deleteMutation.error instanceof ApiError
        ? deleteMutation.error.message
        : 'Failed to delete trigger.'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Delete trigger"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-destructive">Delete trigger?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This {trigger.kind === 'EVENT' ? 'event' : 'schedule'} trigger (
          <code className="font-mono">
            {trigger.kind === 'EVENT' ? trigger.eventType : trigger.cronExpression}
          </code>
          ) will stop firing immediately. This cannot be undone.
        </p>
        {deleteError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {deleteError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              deleteMutation.mutate(
                { workflowId, triggerId: trigger.id },
                { onSuccess: () => onClose() },
              )
            }
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Delete trigger
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Triggers section — list per workflow + enable/disable/delete/create
// ---------------------------------------------------------------------------

function TriggerSummary({ trigger }: { trigger: WorkflowTrigger }) {
  if (trigger.kind === 'EVENT') {
    const filterKeyCount = trigger.filter ? Object.keys(trigger.filter).length : 0
    return (
      <span className="text-xs text-muted-foreground">
        <code className="font-mono text-foreground">{trigger.eventType}</code>
        {filterKeyCount > 0
          ? ` · ${filterKeyCount} filter ${filterKeyCount === 1 ? 'key' : 'keys'}`
          : ' · all events'}
      </span>
    )
  }
  return <code className="font-mono text-xs text-foreground">{trigger.cronExpression}</code>
}

function TriggerRow({
  workflowId,
  trigger,
  canManage,
}: {
  workflowId: string
  trigger: WorkflowTrigger
  canManage: boolean
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const updateMutation = useUpdateTrigger()

  let updateError: string | null = null
  if (updateMutation.error) {
    updateError =
      updateMutation.error instanceof ApiError
        ? updateMutation.error.message
        : 'Failed to update trigger.'
  }

  return (
    <li className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TriggerKindBadge kind={trigger.kind} />
          {!trigger.enabled && <Badge variant="muted">Disabled</Badge>}
          <TriggerSummary trigger={trigger} />
          <span className="text-xs text-muted-foreground">
            · Created {new Date(trigger.createdAt).toLocaleDateString()}
          </span>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateMutation.mutate({
                  workflowId,
                  triggerId: trigger.id,
                  input: { enabled: !trigger.enabled },
                })
              }
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {trigger.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Delete trigger"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      {updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {updateError}
        </p>
      )}
      {confirmingDelete && (
        <DeleteTriggerDialog
          workflowId={workflowId}
          trigger={trigger}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  )
}

function TriggersSection({ workflow }: { workflow: Workflow }) {
  const { data, isPending, isError, error } = useQuery(triggersQueryOptions(workflow.id))
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const perms = usePermissions()
  const canManage = perms.has(MANAGE_TRIGGERS_PERMISSION)

  const triggers = data ?? []

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Triggers
        </h4>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add trigger
          </Button>
        )}
      </div>

      {isPending && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading triggers…
        </div>
      )}

      {isError && (
        <p className="py-2 text-xs text-destructive" role="alert">
          {error instanceof Error ? error.message : 'Failed to load triggers.'}
        </p>
      )}

      {!isPending && !isError && triggers.length === 0 && (
        <p className="py-2 text-xs text-muted-foreground">
          No triggers yet. Triggers run this workflow automatically when a domain event fires or on
          a cron schedule.
        </p>
      )}

      {!isPending && !isError && triggers.length > 0 && (
        <ul className="space-y-2 py-1">
          {triggers.map((t) => (
            <TriggerRow key={t.id} workflowId={workflow.id} trigger={t} canManage={canManage} />
          ))}
        </ul>
      )}

      {createDialogOpen && (
        <CreateTriggerDialog workflow={workflow} onClose={() => setCreateDialogOpen(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row component — one workflow with a Download Source button
// ---------------------------------------------------------------------------

function WorkflowRow({ workflow }: { workflow: Workflow }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const forkMutation = useForkWorkflow()
  const perms = usePermissions()
  const canRun = perms.has('workflow:run')

  const isGlobal = workflow.visibility === 'GLOBAL'
  const executability = workflowExecutability(workflow)
  // The Run button is shown when the user has the run permission, but
  // disabled (with tooltip) for not-executable tenant workflows.
  const runDisabled = executability === 'not-executable'

  const requiredActions: string[] = workflow.manifest.requiredActions ?? []
  const timeoutSeconds: number | undefined = workflow.manifest.timeoutSeconds

  async function handleDownload() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const { downloadUrl } = await getWorkflowDownloadUrl(workflow.id)
      // The presigned URL has a short TTL — open it immediately in a new tab
      // so the browser kicks off the download against S3 directly.
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : 'Failed to fetch download URL.')
    } finally {
      setDownloading(false)
    }
  }

  let forkError: string | null = null
  if (forkMutation.error) {
    forkError =
      forkMutation.error instanceof ApiError
        ? forkMutation.error.message
        : 'Failed to fork workflow.'
  }

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">{workflow.name}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {workflow.version}
            </Badge>
            <ExecutabilityBadge workflow={workflow} />
          </div>
          {workflow.manifest.description && (
            <p className="text-sm text-muted-foreground">{workflow.manifest.description}</p>
          )}
          {/* Manifest metadata — requested permissions + timeout */}
          {requiredActions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Required permissions:</span>{' '}
              {requiredActions.map((a) => (
                <code key={a} className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {a}
                </code>
              ))}
            </p>
          )}
          {timeoutSeconds !== undefined && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Timeout:</span> {timeoutSeconds}s
            </p>
          )}
          {/* Hint for not-executable tenant workflows */}
          {executability === 'not-executable' && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
              <Info className="h-3 w-3 shrink-0" />
              This workflow has not passed artifact validation. Re-upload the artifact to enable
              execution.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Uploaded {new Date(workflow.createdAt).toLocaleString()}
          </p>
          {downloadError && (
            <p className="text-xs text-destructive" role="alert">
              {downloadError}
            </p>
          )}
          {forkError && (
            <p className="text-xs text-destructive" role="alert">
              {forkError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canRun && (
            <span
              title={
                runDisabled
                  ? 'Re-upload the artifact to enable execution for this workflow.'
                  : undefined
              }
            >
              <Button
                variant="default"
                size="sm"
                onClick={() => setRunDialogOpen(true)}
                disabled={runDisabled}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run
              </Button>
            </span>
          )}
          {isGlobal && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => forkMutation.mutate(workflow.id)}
              disabled={forkMutation.isPending}
            >
              {forkMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              Fork to my workflows
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            Download source
          </Button>
        </div>
      </div>

      {canRun && (
        <div className="mt-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent runs
          </h4>
          <ExecutionsList workflowId={workflow.id} />
        </div>
      )}

      {/* Triggers render for GLOBAL rows too — the API scopes trigger rows to
          the caller's tenant even when attached to a platform-library workflow. */}
      <TriggersSection workflow={workflow} />

      {runDialogOpen && (
        <RunWorkflowDialog workflow={workflow} onClose={() => setRunDialogOpen(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorkflowsSettingsPage() {
  const { data, isPending, isError, error } = useQuery(workflowsQueryOptions)

  const platformLibrary = data?.filter((w) => w.visibility === 'GLOBAL') ?? []
  const tenantWorkflows = data?.filter((w) => w.visibility === 'TENANT') ?? []

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <PageHeader title="Workflows" breadcrumbs={[{ label: 'Settings' }, { label: 'Workflows' }]} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WorkflowIcon className="h-4 w-4" />
            About workflows
          </CardTitle>
          <CardDescription>
            Workflows are Python programs you author locally against the Pegasus SDK and upload
            here. They run server-side and can call the Pegasus API on your tenant&rsquo;s behalf.
            The platform team publishes a shared library you can use as-is, or download the source
            and re-upload your own customized version.
          </CardDescription>
        </CardHeader>
      </Card>

      {isPending && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading workflows…
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error instanceof Error ? error.message : 'Failed to load workflows.'}</span>
        </div>
      )}

      {!isPending && !isError && (
        <div className="space-y-6">
          {/* Platform library */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Platform library</h2>
              <Badge variant="secondary" className="text-xs">
                {platformLibrary.length}
              </Badge>
            </div>
            <Separator className="mb-3" />
            {platformLibrary.length === 0 ? (
              <EmptyState
                title="No platform workflows yet"
                description="The Pegasus platform team hasn't published any curated workflows yet. Check back later, or contact support if you expected to see workflows here."
              />
            ) : (
              <div className="rounded-md border border-border bg-card px-4">
                {platformLibrary.map((w) => (
                  <WorkflowRow key={w.id} workflow={w} />
                ))}
              </div>
            )}
          </section>

          {/* Tenant workflows */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Your workflows</h2>
              <Badge variant="secondary" className="text-xs">
                {tenantWorkflows.length}
              </Badge>
            </div>
            <Separator className="mb-3" />
            {tenantWorkflows.length === 0 ? (
              <EmptyState
                title="No workflows yet"
                description="Your team hasn't uploaded any workflows. Workflows are authored locally with the Pegasus Workflows SDK and pushed via the CLI using an API token with the workflow_developer role."
              />
            ) : (
              <div className="rounded-md border border-border bg-card px-4">
                {tenantWorkflows.map((w) => (
                  <WorkflowRow key={w.id} workflow={w} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
