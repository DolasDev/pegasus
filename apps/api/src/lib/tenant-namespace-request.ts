// ---------------------------------------------------------------------------
// Request a tenant's own Temporal namespace (legacy-runner retirement).
//
// Every tenant-runner Automation runs in its tenant's own namespace; there is
// no shared runner to fall back to. So a tenant that publishes, forks or runs
// an Automation without one gets one requested automatically, through the
// same steps an admin's Provision button takes:
//
//   no row                       → create the PROVISIONING row, invoke
//   PROVISIONING, lease expired  → re-invoke (the previous run was killed)
//   FAILED                       → FAILED → PROVISIONING, invoke
//   PROVISIONING, lease held     → nothing: a run is on it
//   READY / DRAINING / ACTIVE / REVERTING → nothing: already provisioned
//   DEPROVISIONING               → nothing: refused (CONFLICT)
//
// The provisioner runs asynchronously (lib/temporal-provisioner-invoke.ts);
// once it marks the row READY, the trigger dispatcher's phase 0 advances it
// to ACTIVE (lib/temporal-namespace-cutover.ts).
//
// Never throws for the outcomes it models: callers (finalize, fork, the run
// path, the dispatcher) treat a failed request as logged, not fatal. A failed
// invoke marks the row FAILED, exactly as the admin route always has, and the
// dispatcher's phase 0 retries it later.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import {
  createTenantTemporalNamespaceRepository,
  type TenantTemporalNamespaceRow,
} from '../repositories/tenant-temporal-namespace.repository'
import { tenantNamespaceName } from './temporal-cloud-ops'
import {
  invokeTemporalProvisioner,
  temporalProvisionerFunctionName,
} from './temporal-provisioner-invoke'
import { tenantTaskQueueEnv } from './workflow-route'
import { logger } from './logger'

/** What started a request: an admin, or the platform on a tenant's behalf. */
export type TenantNamespaceRequestCause = 'admin' | 'publish' | 'fork' | 'start' | 'retry'

export type RequestTenantNamespaceResult =
  /** The provisioner was invoked for `row` (`before` is the row as found, null if new). */
  | {
      outcome: 'REQUESTED'
      before: TenantTemporalNamespaceRow | null
      row: TenantTemporalNamespaceRow
    }
  /** A provisioner run holds the row's lease: nothing to do. */
  | { outcome: 'IN_PROGRESS'; row: TenantTemporalNamespaceRow }
  /** Already provisioned (READY, DRAINING, ACTIVE or REVERTING). */
  | { outcome: 'EXISTS'; row: TenantTemporalNamespaceRow }
  /** DEPROVISIONING, or the row moved under a compare-and-set. */
  | { outcome: 'CONFLICT'; row: TenantTemporalNamespaceRow }
  /** No provisioner (or no platform namespace) in this environment. */
  | { outcome: 'NOT_CONFIGURED' }
  /** The invoke failed; the row is now FAILED. */
  | {
      outcome: 'INVOKE_FAILED'
      before: TenantTemporalNamespaceRow | null
      row: TenantTemporalNamespaceRow
      message: string
    }

/** Whether this environment provisions tenant namespaces (staging, prod). */
export function tenantNamespacesConfigured(): boolean {
  return temporalProvisionerFunctionName() !== null
}

/**
 * The tenant's full namespace id and gRPC address, from the platform
 * namespace's account suffix (`pegasus-<env>.<account>`). Null when the API
 * has no Temporal Cloud namespace configured.
 */
export function tenantNamespaceTarget(
  tenantId: string,
): { namespace: string; grpcAddress: string } | null {
  const platform = process.env['TEMPORAL_NAMESPACE'] ?? ''
  const account = platform.split('.')[1]
  if (!account) return null
  const namespace = `${tenantNamespaceName(tenantTaskQueueEnv(), tenantId)}.${account}`
  return { namespace, grpcAddress: `${namespace}.tmprl.cloud:7233` }
}

function leaseHeld(row: TenantTemporalNamespaceRow, now: Date): boolean {
  return row.leaseExpiresAt !== null && row.leaseExpiresAt > now
}

/**
 * Requests `tenantId`'s namespace (see the module header for the table).
 * `beforeInvoke` runs after the row is in PROVISIONING and before the invoke
 * (the admin route writes its audit row there).
 */
export async function requestTenantNamespace(
  db: PrismaClient,
  tenantId: string,
  opts: {
    cause: TenantNamespaceRequestCause
    now?: Date
    beforeInvoke?: (
      before: TenantTemporalNamespaceRow | null,
      row: TenantTemporalNamespaceRow,
    ) => Promise<void>
  },
): Promise<RequestTenantNamespaceResult> {
  if (!tenantNamespacesConfigured()) return { outcome: 'NOT_CONFIGURED' }
  const repo = createTenantTemporalNamespaceRepository(db)
  const now = opts.now ?? new Date()

  const before = await repo.findByTenant(tenantId)
  let row: TenantTemporalNamespaceRow

  if (!before) {
    const target = tenantNamespaceTarget(tenantId)
    if (!target) return { outcome: 'NOT_CONFIGURED' }
    const created = await repo.createProvisioning({ tenantId, ...target })
    // A concurrent request won the insert: its caller invokes.
    if (created.outcome === 'exists') return { outcome: 'IN_PROGRESS', row: created.row }
    row = created.row
  } else {
    switch (before.status) {
      case 'READY':
      case 'DRAINING':
      case 'ACTIVE':
      case 'REVERTING':
        return { outcome: 'EXISTS', row: before }
      case 'DEPROVISIONING':
        return { outcome: 'CONFLICT', row: before }
      case 'PROVISIONING':
        if (leaseHeld(before, now)) return { outcome: 'IN_PROGRESS', row: before }
        row = before
        break
      case 'FAILED': {
        if (!(await repo.transition(tenantId, ['FAILED'], 'PROVISIONING'))) {
          return { outcome: 'CONFLICT', row: (await repo.findByTenant(tenantId)) ?? before }
        }
        row = (await repo.findByTenant(tenantId)) ?? before
        break
      }
    }
  }

  if (opts.beforeInvoke) await opts.beforeInvoke(before, row)

  try {
    await invokeTemporalProvisioner({ action: 'provision', tenantId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('temporal_namespace.request_invoke_failed', {
      tenantId,
      cause: opts.cause,
      error: message,
    })
    await repo.markFailed(tenantId, `invoke failed: ${message}`)
    return { outcome: 'INVOKE_FAILED', before, row, message }
  }

  if (opts.cause !== 'admin') {
    logger.info('temporal_namespace.auto_requested', {
      audit: true,
      tenantId,
      namespace: row.namespace,
      cause: opts.cause,
      from: before?.status ?? null,
    })
  }
  return { outcome: 'REQUESTED', before, row }
}

/**
 * Best-effort wrapper for publish and fork: requests the namespace and never
 * throws. Returns the row status to report to the author, or null when this
 * environment doesn't provision namespaces.
 */
export async function requestTenantNamespaceQuietly(
  db: PrismaClient,
  tenantId: string,
  cause: Exclude<TenantNamespaceRequestCause, 'admin'>,
): Promise<{ status: TenantTemporalNamespaceRow['status']; ready: boolean } | null> {
  try {
    const result = await requestTenantNamespace(db, tenantId, { cause })
    if (result.outcome === 'NOT_CONFIGURED') return null
    const status = result.outcome === 'INVOKE_FAILED' ? 'FAILED' : result.row.status
    return { status, ready: status === 'ACTIVE' }
  } catch (err) {
    logger.error('temporal_namespace.request_failed', {
      tenantId,
      cause,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
