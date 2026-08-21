/**
 * Integration tests for the IntegrationCorrelation repository (Gap A).
 *
 * These run through `createTenantDb` rather than the root client on purpose:
 * the model is in TENANT_SCOPED_MODELS, so tenant isolation is enforced by the
 * Prisma extension and NOT by any `where` clause in the repository. Testing
 * against the root client would exercise a code path production never takes and
 * would silently pass if the model were dropped from that set.
 *
 * The cases worth a real database are the ones the dual uniqueness creates:
 * re-binding a local entity to a new external key must overwrite, while binding
 * an external key already claimed by a DIFFERENT local entity must refuse
 * rather than steal it.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createIntegrationCorrelationRepository } from '../integration-correlation.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TENANT_A_SLUG = 'test-integration-correlation-a'
const TENANT_B_SLUG = 'test-integration-correlation-b'

const INTEGRATION = 'atlas_settlement'
const ENTITY_TYPE = 'settlement'
const LOCAL_TYPE = 'shipment'
const USER = 'svc-correlation-test'

let tenantAId: string
let tenantBId: string

afterAll(async () => {
  if (hasDb) {
    await db.integrationCorrelation
      .deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('IntegrationCorrelationRepository (integration)', () => {
  let repo: ReturnType<typeof createIntegrationCorrelationRepository>

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      db.tenant.upsert({
        where: { slug: TENANT_A_SLUG },
        create: { name: 'Test Tenant (Correlation A)', slug: TENANT_A_SLUG },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: TENANT_B_SLUG },
        create: { name: 'Test Tenant (Correlation B)', slug: TENANT_B_SLUG },
        update: {},
      }),
    ])
    tenantAId = a.id
    tenantBId = b.id
    repo = createIntegrationCorrelationRepository(
      createTenantDb(db as unknown as PrismaClient, tenantAId) as unknown as PrismaClient,
    )
  })

  beforeEach(async () => {
    await db.integrationCorrelation.deleteMany({
      where: { tenantId: { in: [tenantAId, tenantBId] } },
    })
  })

  const bind = (localEntityId: string, entityKey: string) =>
    repo.upsert({
      tenantId: tenantAId,
      integrationId: INTEGRATION,
      entityType: ENTITY_TYPE,
      localEntityType: LOCAL_TYPE,
      localEntityId,
      entityKey,
      updatedByUserId: USER,
    })

  it('returns null for an unbound local entity', async () => {
    const found = await repo.findByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-missing')
    expect(found).toBeNull()
  })

  it('creates a binding readable from both directions', async () => {
    const { row, outcome } = await bind('ship-1', 'SETT-1:PARTY-9')
    expect(outcome).toBe('created')
    expect(row?.entityKey).toBe('SETT-1:PARTY-9')

    const byLocal = await repo.findByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-1')
    expect(byLocal?.entityKey).toBe('SETT-1:PARTY-9')

    const byExternal = await repo.findByExternal(INTEGRATION, ENTITY_TYPE, 'SETT-1:PARTY-9')
    expect(byExternal?.localEntityId).toBe('ship-1')
  })

  it('re-binding the identical pair is a no-op, not a duplicate row', async () => {
    await bind('ship-1', 'SETT-1:PARTY-9')
    const { outcome } = await bind('ship-1', 'SETT-1:PARTY-9')
    expect(outcome).toBe('unchanged')

    const count = await db.integrationCorrelation.count({ where: { tenantId: tenantAId } })
    expect(count).toBe(1)
  })

  it('re-points a local entity when the partner issues a new key', async () => {
    await bind('ship-1', 'SETT-OLD:PARTY-9')
    const { row, outcome } = await bind('ship-1', 'SETT-NEW:PARTY-9')
    expect(outcome).toBe('rebound')
    expect(row?.entityKey).toBe('SETT-NEW:PARTY-9')

    // The stale external key must no longer resolve to anything.
    const stale = await repo.findByExternal(INTEGRATION, ENTITY_TYPE, 'SETT-OLD:PARTY-9')
    expect(stale).toBeNull()
  })

  it('refuses to steal an external key already bound to another local entity', async () => {
    await bind('ship-1', 'SETT-1:PARTY-9')
    const { row, outcome } = await bind('ship-2', 'SETT-1:PARTY-9')

    expect(outcome).toBe('conflict')
    expect(row).toBeNull()

    // ship-1 keeps the key; ship-2 gains nothing.
    const owner = await repo.findByExternal(INTEGRATION, ENTITY_TYPE, 'SETT-1:PARTY-9')
    expect(owner?.localEntityId).toBe('ship-1')
    const loser = await repo.findByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-2')
    expect(loser).toBeNull()
  })

  it('scopes the same key independently per entityType', async () => {
    await bind('ship-1', 'SETT-1:PARTY-9')
    const { outcome } = await repo.upsert({
      tenantId: tenantAId,
      integrationId: INTEGRATION,
      entityType: 'document',
      localEntityType: LOCAL_TYPE,
      localEntityId: 'ship-1',
      entityKey: 'SETT-1:PARTY-9',
      updatedByUserId: USER,
    })
    // Different entityType ⇒ a different namespace, so this is not a conflict.
    expect(outcome).toBe('created')
  })

  it('deleting an unbound local entity is a no-op', async () => {
    const count = await repo.deleteByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-absent')
    expect(count).toBe(0)
  })

  it('deletes a binding by its local side', async () => {
    await bind('ship-1', 'SETT-1:PARTY-9')
    expect(await repo.deleteByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-1')).toBe(1)
    expect(await repo.findByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-1')).toBeNull()
  })

  it('never reads another tenant’s correlation', async () => {
    // Tenant B binds the same local id and the same external key.
    await db.integrationCorrelation.create({
      data: {
        tenantId: tenantBId,
        integrationId: INTEGRATION,
        entityType: ENTITY_TYPE,
        localEntityType: LOCAL_TYPE,
        localEntityId: 'ship-1',
        entityKey: 'SETT-1:PARTY-9',
        updatedByUserId: USER,
      },
    })

    // Tenant A's repository must not see it from either direction...
    expect(await repo.findByLocal(INTEGRATION, ENTITY_TYPE, LOCAL_TYPE, 'ship-1')).toBeNull()
    expect(await repo.findByExternal(INTEGRATION, ENTITY_TYPE, 'SETT-1:PARTY-9')).toBeNull()

    // ...and must be free to bind the identical pair for itself, because the
    // uniqueness is per tenant, not global.
    const { outcome } = await bind('ship-1', 'SETT-1:PARTY-9')
    expect(outcome).toBe('created')
  })
})
