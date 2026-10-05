// ---------------------------------------------------------------------------
// Admin Temporal-namespace handler — /api/admin/tenants/:tenantId/temporal-namespace/**
//
// Phase 3b: provision, rotate the key of, and delete a tenant's own Temporal
// Cloud namespace. The work itself happens in the temporal-provisioner Lambda
// (async invoke); these routes move the row's status, write the audit log and
// return 202. Admin-web polls GET for progress.
//
// Mounted as a sub-router on adminTenantsRouter (PLATFORM_ADMIN auth on the
// parent). DB: the root client; the repository never returns key material
// and neither does any response here.
//
// Not configured (no provisioner deployed: TEMPORAL_PROVISIONER_FUNCTION_NAME
// unset): every mutation answers 503 TEMPORAL_PROVISIONING_NOT_CONFIGURED and
// writes nothing; GET reports `configured: false`.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Prisma } from '@prisma/client'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { writeAuditLog } from './audit'
import { logger } from '../../lib/logger'
import { tenantNamespaceName } from '../../lib/temporal-cloud-ops'
import { tenantTaskQueueEnv } from '../../lib/workflow-route'
import {
  invokeTemporalProvisioner,
  temporalProvisionerFunctionName,
} from '../../lib/temporal-provisioner-invoke'
import {
  createTenantTemporalNamespaceRepository,
  type TenantTemporalNamespaceRow,
} from '../../repositories/tenant-temporal-namespace.repository'

export const adminTemporalNamespaceRouter = new Hono<AdminEnv>()

const repo = createTenantTemporalNamespaceRepository(db)

type ProvisionerAction = 'provision' | 'rotate' | 'deprovision'

function toDto(row: TenantTemporalNamespaceRow) {
  return {
    tenantId: row.tenantId,
    namespace: row.namespace,
    grpcAddress: row.grpcAddress,
    status: row.status,
    step: row.step,
    /** A provisioner run holds the row right now. */
    busy: row.leaseExpiresAt !== null && row.leaseExpiresAt > new Date(),
    lastError: row.lastError,
    apiKeyExpiresAt: row.apiKeyExpiresAt?.toISOString() ?? null,
    previousKeyRetireAt: row.previousKeyRetireAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Audit snapshots: the DTO, which never carries key material. */
function snapshot(row: TenantTemporalNamespaceRow | null): Prisma.InputJsonValue | null {
  return row ? (toDto(row) as unknown as Prisma.InputJsonValue) : null
}

/**
 * The tenant's full namespace id and gRPC address, from the platform
 * namespace's account suffix (`pegasus-<env>.<account>`). Null when the API
 * has no Temporal Cloud namespace configured.
 */
function tenantNamespaceTarget(
  tenantId: string,
): { namespace: string; grpcAddress: string } | null {
  const platform = process.env['TEMPORAL_NAMESPACE'] ?? ''
  const account = platform.split('.')[1]
  if (!account) return null
  const namespace = `${tenantNamespaceName(tenantTaskQueueEnv(), tenantId)}.${account}`
  return { namespace, grpcAddress: `${namespace}.tmprl.cloud:7233` }
}

const notConfigured = (c: Context<AdminEnv>) =>
  c.json(
    {
      error: 'Temporal namespace provisioning is not configured for this environment',
      code: 'TEMPORAL_PROVISIONING_NOT_CONFIGURED',
    },
    503,
  )

const conflict = (c: Context<AdminEnv>, row: TenantTemporalNamespaceRow, action: string) =>
  c.json(
    {
      error: `Cannot ${action} while the namespace is ${row.status}`,
      code: 'CONFLICT',
      data: toDto(row),
    },
    409,
  )

function leaseHeld(row: TenantTemporalNamespaceRow): boolean {
  return row.leaseExpiresAt !== null && row.leaseExpiresAt > new Date()
}

async function audit(
  c: Context<AdminEnv>,
  action: string,
  tenantId: string,
  before: TenantTemporalNamespaceRow | null,
  after: TenantTemporalNamespaceRow | null,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeAuditLog(
      tx,
      c.get('adminSub'),
      c.get('adminEmail'),
      action,
      'TENANT',
      tenantId,
      snapshot(before),
      snapshot(after),
      c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
      c.req.header('user-agent'),
    )
  })
}

/**
 * Starts the provisioner. On a failed invoke the row is marked FAILED (except
 * for rotate, which leaves a working READY row alone) so it can be retried.
 */
async function start(
  c: Context<AdminEnv>,
  action: ProvisionerAction,
  tenantId: string,
  row: TenantTemporalNamespaceRow,
) {
  try {
    await invokeTemporalProvisioner({ action, tenantId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('admin.temporal_namespace.invoke_failed', { tenantId, action, error: message })
    if (action !== 'rotate') await repo.markFailed(tenantId, `invoke failed: ${message}`)
    return c.json(
      { error: 'Could not start the Temporal provisioner', code: 'PROVISIONER_INVOKE_FAILED' },
      502,
    )
  }
  return c.json({ data: toDto(row) }, 202)
}

async function tenantExists(tenantId: string): Promise<boolean> {
  return (await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) !== null
}

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.get('/', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const row = await repo.findByTenant(tenantId)
  return c.json({
    data: row ? toDto(row) : null,
    configured: temporalProvisionerFunctionName() !== null,
  })
})

// ---------------------------------------------------------------------------
// POST / — provision (or resume a FAILED / stuck provision)
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.post('/', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  if (!temporalProvisionerFunctionName()) return notConfigured(c)

  const current = await repo.findByTenant(tenantId)

  if (!current) {
    const target = tenantNamespaceTarget(tenantId)
    if (!target) return notConfigured(c)
    const { row } = await repo.createProvisioning({ tenantId, ...target })
    await audit(c, 'PROVISION_TEMPORAL_NAMESPACE', tenantId, null, row)
    return start(c, 'provision', tenantId, row)
  }

  switch (current.status) {
    case 'READY':
      return c.json({ data: toDto(current) })
    case 'DEPROVISIONING':
      return conflict(c, current, 'provision')
    case 'PROVISIONING':
      // A live run is on it; an expired lease means the run was killed.
      if (leaseHeld(current)) return c.json({ data: toDto(current) }, 202)
      await audit(c, 'PROVISION_TEMPORAL_NAMESPACE', tenantId, current, current)
      return start(c, 'provision', tenantId, current)
    case 'FAILED': {
      if (!(await repo.transition(tenantId, ['FAILED'], 'PROVISIONING'))) {
        return conflict(c, current, 'provision')
      }
      const resumed = (await repo.findByTenant(tenantId))!
      await audit(c, 'PROVISION_TEMPORAL_NAMESPACE', tenantId, current, resumed)
      return start(c, 'provision', tenantId, resumed)
    }
  }
})

// ---------------------------------------------------------------------------
// POST /rotate-key
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.post('/rotate-key', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  if (!temporalProvisionerFunctionName()) return notConfigured(c)

  const current = await repo.findByTenant(tenantId)
  if (!current)
    return c.json({ error: 'No Temporal namespace for this tenant', code: 'NOT_FOUND' }, 404)
  if (current.status !== 'READY') return conflict(c, current, 'rotate the key')

  await audit(c, 'ROTATE_TEMPORAL_NAMESPACE_KEY', tenantId, current, current)
  return start(c, 'rotate', tenantId, current)
})

// ---------------------------------------------------------------------------
// POST /deprovision — READY or FAILED only (3b.2 adds ACTIVE, which must
// never be deprovisioned without a cutover back first).
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.post('/deprovision', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  if (!temporalProvisionerFunctionName()) return notConfigured(c)

  const current = await repo.findByTenant(tenantId)
  if (!current)
    return c.json({ error: 'No Temporal namespace for this tenant', code: 'NOT_FOUND' }, 404)

  if (current.status === 'DEPROVISIONING') {
    if (leaseHeld(current)) return c.json({ data: toDto(current) }, 202)
    await audit(c, 'DEPROVISION_TEMPORAL_NAMESPACE', tenantId, current, current)
    return start(c, 'deprovision', tenantId, current)
  }
  if (current.status !== 'READY' && current.status !== 'FAILED') {
    return conflict(c, current, 'deprovision')
  }
  if (!(await repo.transition(tenantId, ['READY', 'FAILED'], 'DEPROVISIONING'))) {
    return conflict(c, current, 'deprovision')
  }
  const next = (await repo.findByTenant(tenantId))!
  await audit(c, 'DEPROVISION_TEMPORAL_NAMESPACE', tenantId, current, next)
  return start(c, 'deprovision', tenantId, next)
})
