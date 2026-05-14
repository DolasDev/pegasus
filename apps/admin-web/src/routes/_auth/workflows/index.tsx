import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listGlobalWorkflows } from '@/api/workflows'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
    <div className="space-y-6 max-w-5xl">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Global workflow library</h1>
        <p className="text-sm text-muted-foreground">
          Every workflow flagged <span className="font-mono">GLOBAL</span> across the platform.
          These rows belong to the singleton platform tenant; tenant-private workflows are not
          surfaced here. Use this view to verify CI pushes from{' '}
          <span className="font-mono">packages/workflows-stdlib/</span> landed correctly.
        </p>
      </div>

      {isPending && <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>}

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
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{w.version}</td>
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
    </div>
  )
}
