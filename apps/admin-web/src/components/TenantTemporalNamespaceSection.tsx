import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTemporalNamespace,
  provisionTemporalNamespace,
  rotateTemporalNamespaceKey,
  deprovisionTemporalNamespace,
  cutoverTemporalNamespace,
  rollbackTemporalNamespace,
} from '@/api/temporal-namespace'
import type { TemporalNamespace, TemporalNamespaceStatus } from '@/api/temporal-namespace'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Tenant Temporal namespace (Phase 3b) — the tenant's own Temporal Cloud
// namespace for Automations. Provisioning runs asynchronously in the
// temporal-provisioner Lambda; this section polls while it works.
//
// 3b.2 adds routing: Cut over (READY → DRAINING → ACTIVE) moves the tenant's
// Automations into this namespace, Roll back (ACTIVE → REVERTING → READY)
// moves them back. Each drain finishes on its own (the trigger dispatcher
// advances it once the tenant's open runs finish); this section polls.
// ---------------------------------------------------------------------------

const POLL_MS = 5_000
const IN_FLIGHT: ReadonlySet<TemporalNamespaceStatus> = new Set([
  'PROVISIONING',
  'DEPROVISIONING',
  'DRAINING',
  'REVERTING',
])
/** Statuses that hold a served key — all of them rotate. */
const KEY_HOLDING: ReadonlySet<TemporalNamespaceStatus> = new Set([
  'READY',
  'DRAINING',
  'ACTIVE',
  'REVERTING',
])

const STATUS_LABEL: Record<TemporalNamespaceStatus, string> = {
  PROVISIONING: 'Provisioning',
  READY: 'Ready',
  FAILED: 'Failed',
  DEPROVISIONING: 'Deprovisioning',
  DRAINING: 'Cutting over',
  ACTIVE: 'Active',
  REVERTING: 'Rolling back',
}

function StatusBadge({ status }: { status: TemporalNamespaceStatus }) {
  const styles: Record<TemporalNamespaceStatus, string> = {
    PROVISIONING: 'bg-amber-100 text-amber-800',
    READY: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    DEPROVISIONING: 'bg-neutral-200 text-neutral-700',
    DRAINING: 'bg-amber-100 text-amber-800',
    ACTIVE: 'bg-blue-100 text-blue-800',
    REVERTING: 'bg-amber-100 text-amber-800',
  }
  return (
    <span
      data-testid="temporal-namespace-status"
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Where the tenant's Automations run right now, in words. */
function routingText(ns: TemporalNamespace): string {
  const waiting =
    ns.openExecutions != null
      ? ` Waiting for ${ns.openExecutions} open run${ns.openExecutions === 1 ? '' : 's'} to finish.`
      : ''
  switch (ns.status) {
    case 'ACTIVE':
      return 'Automations run in this namespace.'
    case 'DRAINING':
      return `Cutting over: new runs are paused until runs in the shared namespace finish.${waiting}`
    case 'REVERTING':
      return `Rolling back: new runs are paused until runs in this namespace finish.${waiting}`
    default:
      return 'Automations run in the shared platform namespace.'
  }
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

const buttonClass =
  'rounded-md border border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed'
const dangerButtonClass =
  'rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed'
const cancelButtonClass = 'rounded-md border border-border px-3 py-1.5 text-sm'

type Confirming = null | 'deprovision' | 'cutover' | 'rollback'

function NamespacePanel({
  tenantId,
  ns,
  scopedRunnerConfigured,
  onChanged,
}: {
  tenantId: string
  ns: TemporalNamespace
  scopedRunnerConfigured: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming>(null)

  const onError = (fallback: string) => (err: unknown) =>
    setError(err instanceof ApiError ? err.message : fallback)
  const onSuccess = () => {
    setError(null)
    setConfirming(null)
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
  const cutover = useMutation({
    mutationFn: () => cutoverTemporalNamespace(tenantId),
    onSuccess,
    onError: onError('Failed to start the cutover.'),
  })
  const rollback = useMutation({
    mutationFn: () => rollbackTemporalNamespace(tenantId),
    onSuccess,
    onError: onError('Failed to roll back.'),
  })
  const pending =
    retry.isPending ||
    rotate.isPending ||
    deprovision.isPending ||
    cutover.isPending ||
    rollback.isPending ||
    ns.busy

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={ns.status} />
        <code className="text-xs" data-testid="temporal-namespace-name">
          {ns.namespace}
        </code>
        {(ns.status === 'PROVISIONING' || ns.status === 'DEPROVISIONING') && (
          <span className="text-xs text-muted-foreground">
            Working… (step: {ns.step ?? 'starting'})
          </span>
        )}
      </div>

      {KEY_HOLDING.has(ns.status) && (
        <p className="text-sm" data-testid="temporal-namespace-routing">
          {routingText(ns)}
        </p>
      )}

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

      {confirming === null && (
        <div className="flex flex-wrap items-center gap-2">
          {ns.status === 'FAILED' && (
            <button className={buttonClass} disabled={pending} onClick={() => retry.mutate()}>
              {retry.isPending ? 'Restarting…' : 'Retry provisioning'}
            </button>
          )}
          {ns.status === 'READY' && (
            <button
              className={buttonClass}
              disabled={pending || !scopedRunnerConfigured}
              onClick={() => setConfirming('cutover')}
            >
              Cut over
            </button>
          )}
          {ns.status === 'ACTIVE' && (
            <button
              className={dangerButtonClass}
              disabled={pending}
              onClick={() => setConfirming('rollback')}
            >
              Roll back
            </button>
          )}
          {ns.status === 'DRAINING' && (
            <button
              className={cancelButtonClass}
              disabled={pending}
              onClick={() => rollback.mutate()}
            >
              {rollback.isPending ? 'Cancelling…' : 'Cancel cutover'}
            </button>
          )}
          {KEY_HOLDING.has(ns.status) && (
            <button className={buttonClass} disabled={pending} onClick={() => rotate.mutate()}>
              {rotate.isPending ? 'Rotating…' : 'Rotate key'}
            </button>
          )}
          {(ns.status === 'READY' || ns.status === 'FAILED') && (
            <button
              className={dangerButtonClass}
              disabled={pending}
              onClick={() => setConfirming('deprovision')}
            >
              Deprovision
            </button>
          )}
        </div>
      )}

      {ns.status === 'READY' && !scopedRunnerConfigured && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="temporal-namespace-no-scoped-runner"
        >
          Cutover is unavailable: the scoped tenant-runner is not deployed in this environment.
        </p>
      )}

      {/* In-page confirmations, as TenantVpnSection does for delete. */}
      {confirming === 'cutover' && (
        <Confirm
          testId="temporal-namespace-confirm-cutover"
          confirmLabel={cutover.isPending ? 'Cutting over…' : 'Yes, cut over'}
          disabled={cutover.isPending}
          onConfirm={() => cutover.mutate()}
          onCancel={() => setConfirming(null)}
        >
          Move this tenant's Automations to <code className="text-xs">{ns.namespace}</code>? New
          runs are refused (and events wait) until runs in the shared namespace finish, at most
          about 15 minutes; then everything runs in this namespace with its own key.
        </Confirm>
      )}
      {confirming === 'rollback' && (
        <Confirm
          testId="temporal-namespace-confirm-rollback"
          danger
          confirmLabel={rollback.isPending ? 'Rolling back…' : 'Yes, roll back'}
          disabled={rollback.isPending}
          onConfirm={() => rollback.mutate()}
          onCancel={() => setConfirming(null)}
        >
          Move this tenant's Automations back to the shared namespace? New runs are refused until
          runs in <code className="text-xs">{ns.namespace}</code> finish.
        </Confirm>
      )}
      {confirming === 'deprovision' && (
        <Confirm
          testId="temporal-namespace-confirm-deprovision"
          danger
          confirmLabel={deprovision.isPending ? 'Deprovisioning…' : 'Yes, deprovision'}
          disabled={deprovision.isPending}
          onConfirm={() => deprovision.mutate()}
          onCancel={() => setConfirming(null)}
        >
          Delete <code className="text-xs">{ns.namespace}</code> and its keys from Temporal Cloud?
          Workflow history in it is lost.
        </Confirm>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function Confirm({
  testId,
  danger = false,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
  children,
}: {
  testId: string
  danger?: boolean
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-md border p-3 space-y-2 ${
        danger ? 'border-destructive/50 bg-destructive/5' : 'border-primary/40 bg-primary/5'
      }`}
      data-testid={testId}
    >
      <p className="text-sm">{children}</p>
      <div className="flex gap-2">
        <button
          className={danger ? dangerButtonClass : buttonClass}
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button className={cancelButtonClass} onClick={onCancel}>
          Cancel
        </button>
      </div>
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

  const { data: ns, configured, scopedRunnerConfigured } = query.data
  if (ns) {
    return (
      <NamespacePanel
        tenantId={tenantId}
        ns={ns}
        scopedRunnerConfigured={scopedRunnerConfigured}
        onChanged={refresh}
      />
    )
  }

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
