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
  KEY_HOLDING_STATUSES,
  MIGRATING_STATUSES,
  type TenantTemporalNamespaceRow,
} from '../../repositories/tenant-temporal-namespace.repository'
import { loadTenantRunnerConfig } from '../../lib/tenant-runner'
import { keyAuthorizedOnNamespace } from '../../lib/temporal-namespace-readiness'
import { countOpenTenantRunnerExecutions } from '../../lib/temporal-namespace-cutover'

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
  return row ? toDto(row) : null
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

/** The scoped runner task definition is deployed here (3b.2 cutover prerequisite). */
function scopedRunnerConfigured(): boolean {
  return loadTenantRunnerConfig()?.scopedTaskDefinition != null
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
  // While a drain runs, how many executions it is still waiting for.
  const openExecutions =
    row && (MIGRATING_STATUSES as readonly string[]).includes(row.status)
      ? await countOpenTenantRunnerExecutions(
          db,
          tenantId,
          row.status === 'DRAINING' ? null : row.namespace,
        )
      : null
  return c.json({
    data: row ? { ...toDto(row), openExecutions } : null,
    configured: temporalProvisionerFunctionName() !== null,
    scopedRunnerConfigured: scopedRunnerConfigured(),
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
    case 'DRAINING':
    case 'ACTIVE':
    case 'REVERTING':
      // Already provisioned (and possibly routed): nothing to do.
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
  // Any status holding a served key rotates, a cut-over tenant above all.
  if (!(KEY_HOLDING_STATUSES as readonly string[]).includes(current.status)) {
    return conflict(c, current, 'rotate the key')
  }

  await audit(c, 'ROTATE_TEMPORAL_NAMESPACE_KEY', tenantId, current, current)
  return start(c, 'rotate', tenantId, current)
})

// ---------------------------------------------------------------------------
// POST /deprovision — READY or FAILED only. A routed (ACTIVE) or migrating
// (DRAINING / REVERTING) tenant must be rolled back to READY first: its
// executions live, or are about to live, in the namespace.
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

// ---------------------------------------------------------------------------
// POST /cutover — READY → DRAINING (Phase 3b.2)
//
// Starts routing the tenant's Automations to its own namespace. New
// tenant-runner starts are refused (409 TENANT_MIGRATING) from now on; the
// trigger dispatcher moves the row to ACTIVE once the tenant's open
// shared-namespace executions finish (lib/temporal-namespace-cutover.ts).
//
// Refused unless everything an ACTIVE tenant depends on is in place: the
// scoped runner task definition is deployed here (503), no provisioner run
// holds the row (409), and the tenant's current key is authorized on its
// namespace for every API a runner needs (409 KEY_NOT_READY). Idempotent: a
// row already DRAINING or ACTIVE answers 200 with itself.
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.post('/cutover', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const current = await repo.findByTenant(tenantId)
  if (!current)
    return c.json({ error: 'No Temporal namespace for this tenant', code: 'NOT_FOUND' }, 404)
  if (current.status === 'DRAINING' || current.status === 'ACTIVE') {
    return c.json({ data: toDto(current) })
  }
  if (current.status !== 'READY') return conflict(c, current, 'cut over')
  if (leaseHeld(current)) {
    return c.json(
      {
        error: 'Cannot cut over while a provisioner run holds the namespace; try again shortly',
        code: 'CONFLICT',
        data: toDto(current),
      },
      409,
    )
  }

  if (!scopedRunnerConfigured()) {
    return c.json(
      {
        error:
          'The scoped tenant-runner task definition is not deployed in this environment, so a cut-over tenant could not run',
        code: 'SCOPED_RUNNER_NOT_CONFIGURED',
      },
      503,
    )
  }

  let authorized: boolean
  try {
    const key = await repo.getDecryptedKey(tenantId)
    authorized = key !== null && (await keyAuthorizedOnNamespace(key))
  } catch (err) {
    // Only the error's name: never risk echoing key material.
    logger.error('admin.temporal_namespace.cutover_key_check_failed', {
      tenantId,
      errorName: err instanceof Error ? err.name : 'unknown',
    })
    return c.json(
      { error: 'Could not check the namespace key on Temporal Cloud', code: 'KEY_CHECK_FAILED' },
      502,
    )
  }
  if (!authorized) {
    return c.json(
      {
        error:
          'The namespace key is not yet authorized for every API a runner needs. Try again in a few minutes.',
        code: 'KEY_NOT_READY',
        data: toDto(current),
      },
      409,
    )
  }

  if (!(await repo.transition(tenantId, ['READY'], 'DRAINING'))) {
    return conflict(c, (await repo.findByTenant(tenantId)) ?? current, 'cut over')
  }
  const next = (await repo.findByTenant(tenantId))!
  await audit(c, 'CUTOVER_TEMPORAL_NAMESPACE', tenantId, current, next)
  logger.info('admin.temporal_namespace.cutover_started', {
    audit: true,
    tenantId,
    namespace: next.namespace,
  })
  return c.json({ data: toDto(next) })
})

// ---------------------------------------------------------------------------
// POST /rollback — back to the shared namespace (Phase 3b.2)
//
//   ACTIVE   → REVERTING: starts refused while the tenant's open executions in
//                         its own namespace finish; the dispatcher then moves
//                         the row to READY.
//   DRAINING → READY:     cancels a cutover still draining. Nothing has run in
//                         the tenant namespace yet, so no drain is needed.
// Idempotent: REVERTING answers 200 with itself.
// ---------------------------------------------------------------------------
adminTemporalNamespaceRouter.post('/rollback', async (c) => {
  const tenantId = c.req.param('tenantId')!
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const current = await repo.findByTenant(tenantId)
  if (!current)
    return c.json({ error: 'No Temporal namespace for this tenant', code: 'NOT_FOUND' }, 404)
  if (current.status === 'REVERTING') return c.json({ data: toDto(current) })

  const to =
    current.status === 'ACTIVE' ? 'REVERTING' : current.status === 'DRAINING' ? 'READY' : null
  if (!to) return conflict(c, current, 'roll back')
  if (!(await repo.transition(tenantId, [current.status], to))) {
    return conflict(c, (await repo.findByTenant(tenantId)) ?? current, 'roll back')
  }
  const next = (await repo.findByTenant(tenantId))!
  await audit(c, 'ROLLBACK_TEMPORAL_NAMESPACE', tenantId, current, next)
  logger.info('admin.temporal_namespace.rollback_started', {
    audit: true,
    tenantId,
    namespace: next.namespace,
    from: current.status,
    to,
  })
  return c.json({ data: toDto(next) })
})
