import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getVpnStatus,
  provisionVpn,
  rotateVpn,
  suspendVpn,
  resumeVpn,
  deleteVpn,
  downloadClientConfig,
} from '@/api/vpn'
import type { VpnPeerStatus, VpnStatus } from '@/api/vpn'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(raw: string): string {
  const bytes = Number(raw)
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

function formatHandshakeAge(secs: number | null): string {
  if (secs === null) return 'never'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function StatusBadge({ status }: { status: VpnStatus }) {
  const styles: Record<VpnStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    ACTIVE: 'bg-green-100 text-green-800',
    SUSPENDED: 'bg-neutral-200 text-neutral-700',
    REVOKED: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Empty state — "Enable VPN" button
// ---------------------------------------------------------------------------

function EmptyState({ tenantId, onProvisioned }: { tenantId: string; onProvisioned: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => provisionVpn(tenantId),
    onSuccess: (res) => {
      if (res.clientConfig) {
        downloadClientConfig(`${tenantId}.conf`, res.clientConfig)
      }
      onProvisioned()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to enable VPN.')
    },
  })

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        This tenant does not have a WireGuard VPN peer. Enable it to generate a{' '}
        <code className="text-xs">client.conf</code> that the tenant installs on their Windows
        Server. The private key is shown only once — download it immediately.
      </p>
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? 'Enabling…' : 'Enable VPN'}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Existing-peer panel
// ---------------------------------------------------------------------------

function PeerPanel({
  tenantId,
  peer,
  onChanged,
}: {
  tenantId: string
  peer: VpnPeerStatus
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const queryClient = useQueryClient()

  function onErr(fallback: string) {
    return (err: unknown) => {
      setError(err instanceof ApiError ? err.message : fallback)
    }
  }

  const rotateMutation = useMutation({
    mutationFn: () => rotateVpn(tenantId),
    onSuccess: (res) => {
      if (res.clientConfig) {
        downloadClientConfig(`${tenantId}.conf`, res.clientConfig)
      }
      setError(null)
      onChanged()
    },
    onError: onErr('Failed to rotate keys.'),
  })
  const suspendMutation = useMutation({
    mutationFn: () => suspendVpn(tenantId),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: onErr('Failed to suspend peer.'),
  })
  const resumeMutation = useMutation({
    mutationFn: () => resumeVpn(tenantId),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: onErr('Failed to resume peer.'),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteVpn(tenantId),
    onSuccess: () => {
      setConfirmDelete(false)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['vpn', tenantId] })
    },
    onError: onErr('Failed to delete peer.'),
  })

  const busy =
    rotateMutation.isPending ||
    suspendMutation.isPending ||
    resumeMutation.isPending ||
    deleteMutation.isPending

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge status={peer.status} />
        <span className="text-sm text-muted-foreground">
          Last handshake {formatHandshakeAge(peer.handshakeAgeSec)}
        </span>
      </div>

      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Overlay IP</dt>
        <dd className="font-mono text-xs">{peer.assignedIp}</dd>
        <dt className="text-muted-foreground">Public key</dt>
        <dd className="font-mono text-xs break-all">{peer.publicKey}</dd>
        <dt className="text-muted-foreground">Received</dt>
        <dd>{formatBytes(peer.rxBytes)}</dd>
        <dt className="text-muted-foreground">Transmitted</dt>
        <dd>{formatBytes(peer.txBytes)}</dd>
      </dl>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <button
          onClick={() => rotateMutation.mutate()}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {rotateMutation.isPending ? 'Rotating…' : 'Rotate key'}
        </button>
        {peer.status !== 'SUSPENDED' && peer.status !== 'REVOKED' && (
          <button
            onClick={() => suspendMutation.mutate()}
            disabled={busy}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {suspendMutation.isPending ? 'Suspending…' : 'Suspend'}
          </button>
        )}
        {peer.status === 'SUSPENDED' && (
          <button
            onClick={() => resumeMutation.mutate()}
            disabled={busy}
            className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resumeMutation.isPending ? 'Resuming…' : 'Resume'}
          </button>
        )}
        {!confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete peer
          </button>
        )}
        {confirmDelete && (
          <>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={busy}
              className="rounded-md border border-destructive bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper — lives inside the tenant detail page
// ---------------------------------------------------------------------------

export function TenantVpnSection({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient()

  // Status endpoint returns 404 with code VPN_NOT_FOUND when no peer exists —
  // we treat that as "enabled = false" rather than an error surface.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['vpn', tenantId],
    queryFn: () => getVpnStatus(tenantId),
    retry: false,
    // Light live-refresh so the operator sees handshake age tick while watching.
    refetchInterval: 15_000,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['vpn', tenantId] })
    void refetch()
  }

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading VPN status…</p>
  }

  if (isError) {
    const code = error instanceof ApiError ? error.code : null
    if (code === 'VPN_NOT_FOUND') {
      return <EmptyState tenantId={tenantId} onProvisioned={invalidate} />
    }
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load VPN status.'}
      </p>
    )
  }

  return <PeerPanel tenantId={tenantId} peer={data} onChanged={invalidate} />
}
