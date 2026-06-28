import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listGlobalWorkflows, getRunnerStatus } from '@/api/workflows'
import type { RunnerTask, TenantQuota } from '@/api/workflows'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Temporal Cloud console. Platform engineers inspect any execution's full event
 * history, stack traces, and retries here. The console is cross-tenant (every
 * tenant's runs are visible in a namespace), so it is deliberately surfaced only
 * in admin-web — never in the tenant app, which has no per-tenant isolation in
 * the Temporal UI. The namespace differs per environment (staging vs prod), so
 * we link to the namespaces list and let the engineer pick.
 */
const TEMPORAL_CLOUD_URL = 'https://cloud.temporal.io/namespaces'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Runner status section
// ---------------------------------------------------------------------------

function RunnerStatusSection() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-runner-status'],
    queryFn: getRunnerStatus,
    // Refresh every 30 s so the operator sees a near-live view without manual
    // reload. Not aggressive: ECS list/describe are read-only and cheap.
    refetchInterval: 30_000,
  })

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Runner status</h2>
        <p className="text-sm text-muted-foreground">
          Live view of tenant-runner ECS tasks and per-tenant execution quotas. Refreshes every 30
          seconds. Runner tasks run on-demand and scale to zero when idle.
        </p>
      </div>

      {isPending && (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading runner status…</div>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error instanceof Error ? error.message : 'Failed to load runner status.'}
        </div>
      )}

      {data && !data.configPresent && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Runner plane not configured in this environment (
          <span className="font-mono">TENANT_RUNNER_*</span> env vars absent). Runners are only
          active in staging and prod.
        </div>
      )}

      {data && data.configPresent && (
        <div className="space-y-4">
          {/* Live runner tasks */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active runner tasks ({data.runners.length})
            </h3>
            {data.runners.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runner tasks running — scale-to-zero is the steady state.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Tenant ID</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Started at</th>
                      <th className="px-3 py-2 font-medium">Task ARN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.runners.map((runner: RunnerTask) => (
                      <tr key={runner.taskArn}>
                        <td className="px-3 py-2">
                          {runner.tenantId ? (
                            <Link
                              to="/tenants/$id"
                              params={{ id: runner.tenantId }}
                              className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                            >
                              {runner.tenantId}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">unknown</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                              runner.lastStatus === 'RUNNING'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {runner.lastStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateShort(runner.startedAt)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {runner.taskArn.split('/').pop()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Per-tenant quota stats */}
          {data.tenantQuotas.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tenant execution quotas (today UTC)
              </h3>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Tenant</th>
                      <th className="px-3 py-2 font-medium">Today's executions</th>
                      <th className="px-3 py-2 font-medium">Concurrent (active)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.tenantQuotas.map((quota: TenantQuota) => (
                      <tr key={quota.tenantId}>
                        <td className="px-3 py-2">
                          <Link
                            to="/tenants/$id"
                            params={{ id: quota.tenantId }}
                            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {quota.tenantId}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-sm font-medium tabular-nums">
                          {quota.todayCount}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-sm font-medium tabular-nums ${
                              quota.concurrentCount >= 5 ? 'text-destructive' : 'text-foreground'
                            }`}
                          >
                            {quota.concurrentCount}
                          </span>
                          {quota.concurrentCount >= 5 && (
                            <span className="ml-1 text-xs text-destructive">
                              (at cap — new runs blocked)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorkflowsPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-workflows'],
    queryFn: () => listGlobalWorkflows(),
  })

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page header — deep-link into Temporal Cloud for execution inspection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-foreground">Workflows</h1>
          <a
            href={TEMPORAL_CLOUD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Open in Temporal Cloud ↗
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Inspect any execution&apos;s full event history, stack traces, and retries in the Temporal
          Cloud console (pick the environment&apos;s namespace there). The console is cross-tenant —
          for platform engineers only — so it is not surfaced in the tenant app.
        </p>
      </div>

      {/* Runner status — live operational view */}
      <RunnerStatusSection />

      {/* Global workflow library */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Global workflow library</h2>
          <p className="text-sm text-muted-foreground">
            Every workflow flagged <span className="font-mono">GLOBAL</span> across the platform.
            These rows belong to the singleton platform tenant; tenant-private workflows are not
            surfaced here. Use this view to verify CI pushes from{' '}
            <span className="font-mono">packages/workflows-stdlib/</span> landed correctly.
          </p>
        </div>

        {isPending && (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        )}

        {isError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error instanceof Error ? error.message : 'Failed to load workflows.'}
          </div>
        )}

        {!isPending && !isError && data && data.length === 0 && (
          <div className="rounded-md border border-border bg-card px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No GLOBAL workflows yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No tenant is currently flagged as the platform tenant, or the platform tenant
              hasn&rsquo;t uploaded any workflows. Promote a tenant from its detail page to start
              populating the library.
            </p>
          </div>
        )}

        {!isPending && !isError && data && data.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Workflow</th>
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Owning tenant</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm font-medium text-foreground">{w.name}</div>
                      {w.manifest.description && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {w.manifest.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {w.version}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to="/tenants/$id"
                        params={{ id: w.tenantId }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {w.tenantName}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">{w.tenantSlug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(w.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
