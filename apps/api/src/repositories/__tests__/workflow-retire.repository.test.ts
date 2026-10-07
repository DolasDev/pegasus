/**
 * Integration tests for workflow retirement (sdk-feedback 0032).
 *
 * A real database is the point. The guards must see OTHER tenants' triggers and
 * executions: a tenant can bind a trigger to, and run, a GLOBAL workflow it
 * never forked. A tenant-scoped client would see only the platform's own rows
 * and pass while another tenant's trigger was still live. The retire must also
 * be all-or-nothing across versions.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import crypto from 'node:crypto'
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../db'
import { createWorkflowRepository } from '../workflow.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const OWNER_SLUG = 'test-workflow-retire-owner'
const OTHER_SLUG = 'test-workflow-retire-other'
const USER = 'retire-test-user'

let ownerId: string
let otherId: string

const repo = () => createWorkflowRepository(db)

async function seedWorkflow(
  tenantId: string,
  name: string,
  version: string,
  extra: { visibility?: 'GLOBAL' | 'TENANT'; forkedFromWorkflowId?: string } = {},
) {
  const id = crypto.randomUUID()
  return db.workflow.create({
    data: {
      id,
      tenantId,
      name,
      version,
      visibility: extra.visibility ?? 'GLOBAL',
      artifactKey: `workflows/${tenantId}/${id}/${version}.zip`,
      manifest: { name, version },
      createdByUserId: USER,
      ...(extra.forkedFromWorkflowId ? { forkedFromWorkflowId: extra.forkedFromWorkflowId } : {}),
    },
  })
}

async function cleanup() {
  const ids = [ownerId, otherId].filter(Boolean)
  await db.workflowExecution.deleteMany({ where: { tenantId: { in: ids } } })
  await db.workflowTrigger.deleteMany({ where: { tenantId: { in: ids } } })
  await db.workflow.deleteMany({ where: { tenantId: { in: ids } } })
}

afterAll(async () => {
  if (hasDb) {
    await cleanup().catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('workflow retirement (integration)', () => {
  beforeAll(async () => {
    const owner = await db.tenant.upsert({
      where: { slug: OWNER_SLUG },
      create: { name: 'Test Tenant (Retire owner)', slug: OWNER_SLUG },
      update: {},
    })
    const other = await db.tenant.upsert({
      where: { slug: OTHER_SLUG },
      create: { name: 'Test Tenant (Retire other)', slug: OTHER_SLUG },
      update: {},
    })
    ownerId = owner.id
    otherId = other.id
  })

  beforeEach(async () => {
    await cleanup()
  })

  it('retires one version: hidden from get and list, still reachable with includeRetired', async () => {
    const v1 = await seedWorkflow(ownerId, 'send_order_to_partner', '0.1.0')
    const v2 = await seedWorkflow(ownerId, 'send_order_to_partner', '0.2.0')

    const out = await repo().retire({
      ownerTenantId: ownerId,
      name: 'send_order_to_partner',
      version: '0.2.0',
      retiredByUserId: USER,
    })

    expect(out.kind).toBe('retired')
    if (out.kind !== 'retired') return
    expect(out.retired.map((r) => r.version)).toEqual(['0.2.0'])
    expect(out.alreadyRetired).toEqual([])

    // Hidden from the default reads, for the owner and for every other tenant.
    expect(await repo().findByIdForTenant(v2.id, ownerId)).toBeNull()
    expect(await repo().findByIdForTenant(v2.id, otherId)).toBeNull()
    const listed = (await repo().listForTenant(otherId)).map((r) => r.id)
    expect(listed).toContain(v1.id)
    expect(listed).not.toContain(v2.id)

    // …but kept, with its audit fields, for the reads that opt in.
    const kept = await repo().findByIdForTenant(v2.id, ownerId, { includeRetired: true })
    expect(kept?.status).toBe('RETIRED')
    expect(kept?.retiredByUserId).toBe(USER)
    expect(kept?.retiredAt).toBeInstanceOf(Date)
    expect(
      (await repo().listForTenant(ownerId, { includeRetired: true })).map((r) => r.id),
    ).toContain(v2.id)
  })

  it('retires every active version when no version is given', async () => {
    await seedWorkflow(ownerId, 'old_name', '0.1.0')
    await seedWorkflow(ownerId, 'old_name', '0.2.0')
    const keep = await seedWorkflow(ownerId, 'new_name', '0.1.0')

    const out = await repo().retire({
      ownerTenantId: ownerId,
      name: 'old_name',
      retiredByUserId: USER,
    })

    expect(out.kind).toBe('retired')
    if (out.kind !== 'retired') return
    expect(out.retired.map((r) => r.version).sort()).toEqual(['0.1.0', '0.2.0'])
    expect((await repo().listForTenant(ownerId)).map((r) => r.id)).toEqual([keep.id])
  })

  it("is blocked by ANOTHER tenant's enabled trigger, and retires nothing", async () => {
    const v1 = await seedWorkflow(ownerId, 'shared', '0.1.0')
    const v2 = await seedWorkflow(ownerId, 'shared', '0.2.0')
    const trigger = await db.workflowTrigger.create({
      data: {
        tenantId: otherId,
        workflowId: v2.id,
        kind: 'EVENT',
        eventType: 'pegii.sale.saved',
        enabled: true,
        createdByUserId: USER,
      },
    })

    const out = await repo().retire({
      ownerTenantId: ownerId,
      name: 'shared',
      retiredByUserId: USER,
    })

    expect(out).toEqual({
      kind: 'blocked',
      enabledTriggers: [{ id: trigger.id, workflowId: v2.id, version: '0.2.0' }],
      openExecutions: [],
    })
    // All-or-nothing: the unblocked version was not retired either.
    expect(await repo().findByIdForTenant(v1.id, ownerId)).not.toBeNull()
    expect(await repo().findByIdForTenant(v2.id, ownerId)).not.toBeNull()
  })

  it('is not blocked by a disabled trigger', async () => {
    const v = await seedWorkflow(ownerId, 'paused', '0.1.0')
    await db.workflowTrigger.create({
      data: {
        tenantId: otherId,
        workflowId: v.id,
        kind: 'SCHEDULE',
        cronExpression: '*/5 * * * *',
        enabled: false,
        createdByUserId: USER,
      },
    })

    const out = await repo().retire({
      ownerTenantId: ownerId,
      name: 'paused',
      retiredByUserId: USER,
    })

    expect(out.kind).toBe('retired')
  })

  it("is blocked by ANOTHER tenant's open execution, not by a finished one", async () => {
    const v = await seedWorkflow(ownerId, 'busy', '0.1.0')
    const queuedAt = new Date()
    const running = await db.workflowExecution.create({
      data: { tenantId: otherId, workflowId: v.id, status: 'RUNNING', input: {}, queuedAt },
    })
    await db.workflowExecution.create({
      data: { tenantId: otherId, workflowId: v.id, status: 'COMPLETED', input: {}, queuedAt },
    })

    const blocked = await repo().retire({
      ownerTenantId: ownerId,
      name: 'busy',
      retiredByUserId: USER,
    })
    expect(blocked).toEqual({
      kind: 'blocked',
      enabledTriggers: [],
      openExecutions: [{ id: running.id, workflowId: v.id, version: '0.1.0' }],
    })

    await db.workflowExecution.update({ where: { id: running.id }, data: { status: 'FAILED' } })
    expect(
      (await repo().retire({ ownerTenantId: ownerId, name: 'busy', retiredByUserId: USER })).kind,
    ).toBe('retired')
  })

  it('reports how many tenant forks exist, and leaves them running', async () => {
    const source = await seedWorkflow(ownerId, 'forked', '0.1.0')
    const fork = await seedWorkflow(otherId, 'forked', '0.1.0', {
      visibility: 'TENANT',
      forkedFromWorkflowId: source.id,
    })

    const out = await repo().retire({
      ownerTenantId: ownerId,
      name: 'forked',
      retiredByUserId: USER,
    })

    expect(out.kind === 'retired' && out.forkCount).toBe(1)
    expect(await repo().findByIdForTenant(fork.id, otherId)).not.toBeNull()
  })

  it("is not_found for a name the caller does not own, even when another tenant's is visible", async () => {
    await seedWorkflow(otherId, 'theirs', '0.1.0')

    expect(
      await repo().retire({ ownerTenantId: ownerId, name: 'theirs', retiredByUserId: USER }),
    ).toEqual({ kind: 'not_found' })
    expect(
      await repo().retire({
        ownerTenantId: ownerId,
        name: 'nope',
        version: '9.9.9',
        retiredByUserId: USER,
      }),
    ).toEqual({ kind: 'not_found' })
  })

  it('is idempotent: a second retire reports the version as already retired', async () => {
    await seedWorkflow(ownerId, 'twice', '0.1.0')
    await repo().retire({ ownerTenantId: ownerId, name: 'twice', retiredByUserId: USER })

    const again = await repo().retire({
      ownerTenantId: ownerId,
      name: 'twice',
      retiredByUserId: USER,
    })

    expect(again.kind).toBe('retired')
    if (again.kind !== 'retired') return
    expect(again.retired).toEqual([])
    expect(again.alreadyRetired.map((r) => r.version)).toEqual(['0.1.0'])
  })
})
