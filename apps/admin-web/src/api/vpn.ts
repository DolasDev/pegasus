import { ApiError } from '@pegasus/api-http'
import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'
import { adminFetch } from './client'

// ---------------------------------------------------------------------------
// VPN domain types — mirror the API's PEER_SELECT DTO shape
// ---------------------------------------------------------------------------

export type VpnStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED'

export interface VpnPeer {
  id: string
  tenantId: string
  /** Overlay address, e.g. "10.200.7.1". */
  assignedIp: string
  /** Base64-encoded X25519 public key (Curve25519). */
  publicKey: string
  status: VpnStatus
  /** ISO 8601 or null if the tunnel has never handshaken. */
  lastHandshakeAt: string | null
  /** BigInts are sent as decimal strings to survive JSON.stringify. */
  rxBytes: string
  txBytes: string
  createdAt: string
  updatedAt: string
}

/** Response to GET /vpn/status — same shape as GET /vpn plus handshakeAgeSec. */
export interface VpnPeerStatus extends VpnPeer {
  /** null when lastHandshakeAt is null. */
  handshakeAgeSec: number | null
}

export interface ProvisionVpnResponse {
  data: VpnPeer
  /** Present exactly once — on create and on rotate. Null on idempotent repeats. */
  clientConfig: string | null
  /** false on idempotent repeat POST; means operator must rotate to receive a new key. */
  keyAvailable?: boolean
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Provision a VPN peer for the given tenant. First call returns a
 * `clientConfig` blob containing the tenant private key — download it
 * immediately; the server never re-renders it. Repeat calls return the
 * existing peer with `clientConfig = null`.
 *
 * Uses raw fetch because the response envelope includes `clientConfig`
 * alongside `data`, which the shared adminFetch unwraps away.
 */
export async function provisionVpn(tenantId: string): Promise<ProvisionVpnResponse> {
  const res = await fetch(`${getConfig().apiUrl}/api/admin/tenants/${tenantId}/vpn`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
  })
  const json = (await res.json()) as
    | { data: VpnPeer; clientConfig: string | null; keyAvailable?: boolean }
    | { error: string; code: string }
  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }
  return json
}

export async function rotateVpn(tenantId: string): Promise<ProvisionVpnResponse> {
  const res = await fetch(`${getConfig().apiUrl}/api/admin/tenants/${tenantId}/vpn/rotate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
  })
  const json = (await res.json()) as
    | { data: VpnPeer; clientConfig: string | null }
    | { error: string; code: string }
  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }
  return json
}

export async function getVpnPeer(tenantId: string): Promise<VpnPeer> {
  return adminFetch<VpnPeer>(`/api/admin/tenants/${tenantId}/vpn`)
}

export async function getVpnStatus(tenantId: string): Promise<VpnPeerStatus> {
  return adminFetch<VpnPeerStatus>(`/api/admin/tenants/${tenantId}/vpn/status`)
}

// ---------------------------------------------------------------------------
// VPN diagnose — mirrors apps/api/src/handlers/admin/vpn-diagnose.ts:44-60
// Re-declared rather than imported to keep the workspace boundary clean
// (admin-web does not import from apps/api).
// ---------------------------------------------------------------------------

export type DiagnoseCheckStatus = 'pass' | 'fail' | 'skip'

export interface DiagnoseCheck {
  id: string
  label: string
  status: DiagnoseCheckStatus
  detail: string
  evidence?: Record<string, unknown>
  elapsedMs: number
}

export interface DiagnoseReport {
  tenantId: string
  summary: 'pass' | 'fail'
  firstFailure: string | null
  checks: DiagnoseCheck[]
}

/**
 * Run the layered cloud → hub → tenant diagnose. ~10–30 s round-trip because
 * the handler issues SSM commands against the hub. Should only be invoked on
 * explicit user action — never via TanStack `refetchInterval` or auto-retry.
 */
export async function runVpnDiagnose(tenantId: string): Promise<DiagnoseReport> {
  return adminFetch<DiagnoseReport>(`/api/admin/tenants/${tenantId}/vpn/diagnose`)
}

export async function suspendVpn(tenantId: string): Promise<VpnPeer> {
  return adminFetch<VpnPeer>(`/api/admin/tenants/${tenantId}/vpn/suspend`, { method: 'POST' })
}

export async function resumeVpn(tenantId: string): Promise<VpnPeer> {
  return adminFetch<VpnPeer>(`/api/admin/tenants/${tenantId}/vpn/resume`, { method: 'POST' })
}

export async function deleteVpn(tenantId: string): Promise<void> {
  await adminFetch<void>(`/api/admin/tenants/${tenantId}/vpn`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trigger a browser file download of the given client.conf blob. */
export function downloadClientConfig(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
