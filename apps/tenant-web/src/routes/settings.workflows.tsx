import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Copy,
  Download,
  Globe,
  Loader2,
  Lock,
  Play,
  Workflow as WorkflowIcon,
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
  useForkWorkflow,
  useRunWorkflow,
  workflowsQueryOptions,
} from '@/api/queries/workflows'
import { getWorkflowDownloadUrl, type Workflow, type WorkflowExecution } from '@/api/workflows'
import { ApiError } from '@/api/client'
import { usePermissions } from '@/auth/permissions'

// ---------------------------------------------------------------------------
// Run dialog — collects an optional JSON input object and triggers a run
// ---------------------------------------------------------------------------

function RunWorkflowDialog({
  workflow,
  onClose,
}: {
  workflow: Workflow
  onClose: () => void
}) {
  const [inputText, setInputText] = useState('{}')
  const [parseError, setParseError] = useState<string | null>(null)
  const runMutation = useRunWorkflow()

  let runError: string | null = null
  if (runMutation.error) {
    runError =
      runMutation.error instanceof ApiError ? runMutation.error.message : 'Failed to start run.'
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
    runMutation.mutate(
      { id: workflow.id, input: parsed },
      { onSuccess: () => onClose() },
    )
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
      <p className="mt-1 break-words font-mono text-xs text-destructive">{execution.errorMessage}</p>
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
          </div>
          {workflow.manifest.description && (
            <p className="text-sm text-muted-foreground">{workflow.manifest.description}</p>
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
            <Button variant="default" size="sm" onClick={() => setRunDialogOpen(true)}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run
            </Button>
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
