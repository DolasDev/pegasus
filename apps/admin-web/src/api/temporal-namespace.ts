import { ApiError } from '@pegasus/api-http'
import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'

// ---------------------------------------------------------------------------
// Tenant Temporal namespace (Phase 3b) — mirrors the API's toDto shape in
// apps/api/src/handlers/admin/temporal-namespace.ts. Never carries key
// material.
// ---------------------------------------------------------------------------

export type TemporalNamespaceStatus =
  | 'PROVISIONING'
  /** Provisioned; Automations still run in the shared namespace. */
  | 'READY'
  | 'FAILED'
  | 'DEPROVISIONING'
  /** Cutover in progress (3b.2): new runs paused while shared-namespace runs finish. */
  | 'DRAINING'
  /** Cut over: Automations run in this namespace. */
  | 'ACTIVE'
  /** Rollback in progress: new runs paused while this namespace's runs finish. */
  | 'REVERTING'

export interface TemporalNamespace {
  tenantId: string
  /** Full namespace id, e.g. `pg-staging-a90b22bc4393.chgel`. */
  namespace: string
  grpcAddress: string
  status: TemporalNamespaceStatus
  /** Last completed provisioning step. */
  step: string | null
  /** A provisioner run holds the row right now. */
  busy: boolean
  lastError: string | null
  apiKeyExpiresAt: string | null
  /** Set while a rotated-out key is still alive (grace period). */
  previousKeyRetireAt: string | null
  createdAt: string
  updatedAt: string
  /**
   * GET only, while DRAINING / REVERTING: the open executions the drain is
   * still waiting for. Null (or absent) otherwise.
   */
  openExecutions?: number | null
}

export interface TemporalNamespaceState {
  /** Null when this tenant has no namespace. */
  data: TemporalNamespace | null
  /** False when no provisioner is deployed in this environment. */
  configured: boolean
  /**
   * False when the scoped tenant-runner task definition isn't deployed here,
   * so a cut-over tenant couldn't run: the API refuses a cutover (3b.2).
   */
  scopedRunnerConfigured: boolean
}

// Raw fetch: the envelope carries `configured` beside `data`, which the
// shared adminFetch would unwrap away (same reason as api/vpn.ts).
async function call<T>(tenantId: string, path: string, method: 'GET' | 'POST'): Promise<T> {
  const res = await fetch(
    `${getConfig().apiUrl}/api/admin/tenants/${tenantId}/temporal-namespace${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        'Content-Type': 'application/json',
      },
    },
  )
  const json = (await res.json()) as T | { error: string; code: string }
  if (typeof json === 'object' && json !== null && 'error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }
  return json as T
}

export function getTemporalNamespace(tenantId: string): Promise<TemporalNamespaceState> {
  return call(tenantId, '', 'GET')
}

export function provisionTemporalNamespace(tenantId: string): Promise<{ data: TemporalNamespace }> {
  return call(tenantId, '', 'POST')
}

export function rotateTemporalNamespaceKey(tenantId: string): Promise<{ data: TemporalNamespace }> {
  return call(tenantId, '/rotate-key', 'POST')
}

export function deprovisionTemporalNamespace(
  tenantId: string,
): Promise<{ data: TemporalNamespace }> {
  return call(tenantId, '/deprovision', 'POST')
}

/** READY → DRAINING: start routing the tenant's Automations to this namespace. */
export function cutoverTemporalNamespace(tenantId: string): Promise<{ data: TemporalNamespace }> {
  return call(tenantId, '/cutover', 'POST')
}

/** ACTIVE → REVERTING (back to shared), or DRAINING → READY (cancel a cutover). */
export function rollbackTemporalNamespace(tenantId: string): Promise<{ data: TemporalNamespace }> {
  return call(tenantId, '/rollback', 'POST')
}
