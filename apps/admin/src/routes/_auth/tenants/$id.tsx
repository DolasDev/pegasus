import { useState } from 'react'
import { useParams, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTenant, suspendTenant, reactivateTenant, offboardTenant } from '@/api/tenants'
import type { TenantDetail } from '@/api/tenants'
import { TenantFormDialog } from '@/components/TenantFormDialog'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: TenantDetail['status'] }) {
  const styles = {
    ACTIVE: 'bg-green-100 text-green-800',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    OFFBOARDED: 'bg-neutral-100 text-neutral-600',
  } as const
  const labels = { ACTIVE: 'Active', SUSPENDED: 'Suspended', OFFBOARDED: 'Offboarded' } as const
  return (
    <span
      className={`inline-flex items-center rounded px-2.5 py-1 text-sm font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Info row
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 py-3 border-b border-border last:border-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Offboard confirmation dialog
// ---------------------------------------------------------------------------

function OffboardDialog({
  tenant,
  onClose,
}: {
  tenant: TenantDetail
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [apiError, setApiError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => offboardTenant(tenant.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      void navigate({ to: '/tenants' })
    },
    onError: (err) => {
      setApiError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.currentTarget === e.target) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Offboard tenant</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-foreground">
            You are about to offboard{' '}
            <span className="font-semibold">{tenant.name}</span>. This will:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Set the tenant status to Offboarded immediately.</li>
            <li>Block all API and portal access for this tenant's users.</li>
            <li>Retain all data (soft delete — no records are removed).</li>
          </ul>
          <p className="text-sm font-medium text-destructive">
            This action cannot be undone through the portal.
          </p>
          {apiError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {apiError}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Offboarding…' : 'Offboard tenant'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status action button + inline error
// ---------------------------------------------------------------------------

function StatusActions({ tenant }: { tenant: TenantDetail }) {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)

  const suspendMutation = useMutation({
    mutationFn: () => suspendTenant(tenant.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['tenant', tenant.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      setActionError(null)
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateTenant(tenant.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['tenant', tenant.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      setActionError(null)
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const isPending = suspendMutation.isPending || reactivateMutation.isPending

  if (tenant.status === 'OFFBOARDED') {
    return (
      <p className="text-sm text-muted-foreground">
        This tenant has been offboarded. Status cannot be changed.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {tenant.status === 'ACTIVE' && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => suspendMutation.mutate()}
            disabled={isPending}
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {suspendMutation.isPending ? 'Suspending…' : 'Suspend'}
          </button>
          <p className="text-sm text-muted-foreground">
            Blocks all API and portal access for this tenant until reactivated.
          </p>
        </div>
      )}
      {tenant.status === 'SUSPENDED' && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => reactivateMutation.mutate()}
            disabled={isPending}
            className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {reactivateMutation.isPending ? 'Reactivating…' : 'Reactivate'}
          </button>
          <p className="text-sm text-muted-foreground">Restores normal access for this tenant.</p>
        </div>
      )}
      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TenantDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [offboardOpen, setOffboardOpen] = useState(false)

  const { data: tenant, isPending, isError, error } = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => getTenant(id),
  })

  // When edit succeeds, the dialog calls queryClient.invalidateQueries(['tenants']).
  // We also need to refresh this detail query, so do it on dialog close if we
  // just had an open edit session.
  function handleEditClose() {
    setEditOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['tenant', id] })
  }

  if (isPending) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Link to="/tenants" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to tenants
        </Link>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load tenant.'}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6 max-w-2xl">
        {/* Back link */}
        <Link
          to="/tenants"
          className="inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to tenants
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">{tenant.name}</h1>
            <StatusBadge status={tenant.status} />
          </div>
          {tenant.status !== 'OFFBOARDED' && (
            <button
              onClick={() => setEditOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Edit
            </button>
          )}
        </div>

        {/* Info grid */}
        <div className="rounded-md border border-border bg-card px-4">
          <dl>
            <Row label="Slug">
              <span className="font-mono text-xs">{tenant.slug}</span>
            </Row>
            <Row label="Plan">
              {tenant.plan.charAt(0) + tenant.plan.slice(1).toLowerCase()}
            </Row>
            <Row label="Contact name">{tenant.contactName ?? <em className="text-muted-foreground">—</em>}</Row>
            <Row label="Contact email">
              {tenant.contactEmail ? (
                <a
                  href={`mailto:${tenant.contactEmail}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {tenant.contactEmail}
                </a>
              ) : (
                <em className="text-muted-foreground">—</em>
              )}
            </Row>
            <Row label="Created">{formatDate(tenant.createdAt)}</Row>
            <Row label="Last updated">{formatDate(tenant.updatedAt)}</Row>
            {tenant.deletedAt && <Row label="Offboarded">{formatDate(tenant.deletedAt)}</Row>}
          </dl>
        </div>

        {/* SSO config */}
        {tenant.ssoProviderConfig !== null && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">SSO provider config</h2>
            <pre className="rounded-md border border-border bg-muted/40 p-3 text-xs font-mono overflow-x-auto">
              {JSON.stringify(tenant.ssoProviderConfig, null, 2)}
            </pre>
          </section>
        )}

        {/* Status management */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Status management</h2>
          <StatusActions tenant={tenant} />
        </section>

        {/* Danger zone */}
        {tenant.status !== 'OFFBOARDED' && (
          <section className="space-y-3 rounded-md border border-destructive/30 p-4">
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOffboardOpen(true)}
                className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                Offboard tenant
              </button>
              <p className="text-sm text-muted-foreground">
                Permanently blocks access and marks this tenant as offboarded. Irreversible.
              </p>
            </div>
          </section>
        )}
      </div>

      {editOpen && (
        <TenantFormDialog mode="edit" tenant={tenant} onClose={handleEditClose} />
      )}

      {offboardOpen && (
        <OffboardDialog tenant={tenant} onClose={() => setOffboardOpen(false)} />
      )}
    </>
  )
}
