import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listTenants } from '@/api/tenants'
import type { TenantFilter, TenantStatus } from '@/api/tenants'
import { TenantFormDialog } from '@/components/TenantFormDialog'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25

const FILTER_OPTIONS: { label: string; value: TenantFilter }[] = [
  { label: 'All active', value: 'ALL' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Suspended', value: 'SUSPENDED' },
  { label: 'Offboarded', value: 'OFFBOARDED' },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TenantStatus }) {
  const styles: Record<TenantStatus, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    OFFBOARDED: 'bg-neutral-100 text-neutral-600',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
      {plan.charAt(0) + plan.slice(1).toLowerCase()}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TenantsPage() {
  const [filter, setFilter] = useState<TenantFilter>('ALL')
  const [offset, setOffset] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tenants', filter, offset],
    queryFn: () => listTenants({ filter, limit: PAGE_SIZE, offset }),
  })

  // Reset to page 1 whenever the filter changes.
  function handleFilterChange(f: TenantFilter) {
    setFilter(f)
    setOffset(0)
  }

  const tenants = data?.data ?? []
  const meta = data?.meta
  const hasPrev = offset > 0
  const hasNext = meta !== undefined && offset + PAGE_SIZE < meta.total

  return (
    <>
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Tenants</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Create tenant
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleFilterChange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      {isPending ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load tenants.'}
        </div>
      ) : tenants.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No tenants found.</div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Contact email
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link
                        to="/tenants/$id"
                        params={{ id: tenant.id }}
                        className="hover:underline underline-offset-2"
                      >
                        {tenant.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {tenant.slug}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={tenant.plan} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {tenant.contactEmail ?? <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(tenant.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {meta.total === 0
                  ? 'No results'
                  : `Showing ${offset + 1}–${Math.min(offset + tenants.length, meta.total)} of ${meta.total}`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={!hasPrev}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={!hasNext}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {createOpen && (
      <TenantFormDialog mode="create" onClose={() => setCreateOpen(false)} />
    )}
    </>
  )
}
