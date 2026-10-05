import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTemporalNamespace,
  provisionTemporalNamespace,
  rotateTemporalNamespaceKey,
  deprovisionTemporalNamespace,
} from '@/api/temporal-namespace'
import type { TemporalNamespace, TemporalNamespaceStatus } from '@/api/temporal-namespace'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Tenant Temporal namespace (Phase 3b) — the tenant's own Temporal Cloud
// namespace for Automations. Provisioning runs asynchronously in the
// temporal-provisioner Lambda; this section polls while it works.
// ---------------------------------------------------------------------------

const POLL_MS = 5_000
const IN_FLIGHT: ReadonlySet<TemporalNamespaceStatus> = new Set(['PROVISIONING', 'DEPROVISIONING'])

function StatusBadge({ status }: { status: TemporalNamespaceStatus }) {
  const styles: Record<TemporalNamespaceStatus, string> = {
    PROVISIONING: 'bg-amber-100 text-amber-800',
    READY: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    DEPROVISIONING: 'bg-neutral-200 text-neutral-700',
  }
  return (
    <span
      data-testid="temporal-namespace-status"
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

const buttonClass =
  'rounded-md border border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed'
const dangerButtonClass =
  'rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed'

function NamespacePanel({
  tenantId,
  ns,
  onChanged,
}: {
  tenantId: string
  ns: TemporalNamespace
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirmDeprovision, setConfirmDeprovision] = useState(false)

  const onError = (fallback: string) => (err: unknown) =>
    setError(err instanceof ApiError ? err.message : fallback)
  const onSuccess = () => {
    setError(null)
    setConfirmDeprovision(false)
    onChanged()
  }

  const retry = useMutation({
    mutationFn: () => provisionTemporalNamespace(tenantId),
    onSuccess,
    onError: onError('Failed to restart provisioning.'),
  })
  const rotate = useMutation({
    mutationFn: () => rotateTemporalNamespaceKey(tenantId),
    onSuccess,
    onError: onError('Failed to rotate the key.'),
  })
  const deprovision = useMutation({
    mutationFn: () => deprovisionTemporalNamespace(tenantId),
    onSuccess,
    onError: onError('Failed to deprovision.'),
  })
  const pending = retry.isPending || rotate.isPending || deprovision.isPending || ns.busy

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={ns.status} />
        <code className="text-xs" data-testid="temporal-namespace-name">
          {ns.namespace}
        </code>
        {IN_FLIGHT.has(ns.status) && (
          <span className="text-xs text-muted-foreground">
            Working… (step: {ns.step ?? 'starting'})
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd>
          <code className="text-xs">{ns.grpcAddress}</code>
        </dd>
        <dt className="text-muted-foreground">Key expires</dt>
        <dd>{formatDate(ns.apiKeyExpiresAt)}</dd>
        {ns.previousKeyRetireAt && (
          <>
            <dt className="text-muted-foreground">Previous key retires</dt>
            <dd>{formatDate(ns.previousKeyRetireAt)}</dd>
          </>
        )}
      </dl>

      {ns.lastError && (
        <p
          className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm text-destructive break-words"
          data-testid="temporal-namespace-last-error"
        >
          {ns.lastError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ns.status === 'FAILED' && (
          <button className={buttonClass} disabled={pending} onClick={() => retry.mutate()}>
            {retry.isPending ? 'Restarting…' : 'Retry provisioning'}
          </button>
        )}
        {ns.status === 'READY' && (
          <button className={buttonClass} disabled={pending} onClick={() => rotate.mutate()}>
            {rotate.isPending ? 'Rotating…' : 'Rotate key'}
          </button>
        )}
        {(ns.status === 'READY' || ns.status === 'FAILED') && !confirmDeprovision && (
          <button
            className={dangerButtonClass}
            disabled={pending}
            onClick={() => setConfirmDeprovision(true)}
          >
            Deprovision
          </button>
        )}
      </div>

      {/* In-page confirmation, as TenantVpnSection does for delete. */}
      {confirmDeprovision && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2"
          data-testid="temporal-namespace-confirm-deprovision"
        >
          <p className="text-sm">
            Delete <code className="text-xs">{ns.namespace}</code> and its keys from Temporal Cloud?
            Workflow history in it is lost.
          </p>
          <div className="flex gap-2">
            <button
              className={dangerButtonClass}
              disabled={deprovision.isPending}
              onClick={() => deprovision.mutate()}
            >
              {deprovision.isPending ? 'Deprovisioning…' : 'Yes, deprovision'}
            </button>
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => setConfirmDeprovision(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function TenantTemporalNamespaceSection({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['tenants', tenantId, 'temporal-namespace']
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey,
    queryFn: () => getTemporalNamespace(tenantId),
    refetchInterval: (q) => {
      const status = q.state.data?.data?.status
      return status && IN_FLIGHT.has(status) ? POLL_MS : false
    },
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey })

  const provision = useMutation({
    mutationFn: () => provisionTemporalNamespace(tenantId),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to start provisioning.'),
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError || !query.data) {
    return <p className="text-sm text-destructive">Failed to load the Temporal namespace.</p>
  }

  const { data: ns, configured } = query.data
  if (ns) return <NamespacePanel tenantId={tenantId} ns={ns} onChanged={refresh} />

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
      {configured ? (
        <p className="text-sm text-muted-foreground">
          This tenant's Automations run in the shared platform namespace. Provision a dedicated
          Temporal Cloud namespace with its own scoped key. Nothing routes to it until the tenant is
          cut over.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid="temporal-namespace-not-configured"
        >
          Temporal namespace provisioning is not configured for this environment.
        </p>
      )}
      <button
        className={buttonClass}
        disabled={!configured || provision.isPending}
        onClick={() => provision.mutate()}
      >
        {provision.isPending ? 'Starting…' : 'Provision namespace'}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
