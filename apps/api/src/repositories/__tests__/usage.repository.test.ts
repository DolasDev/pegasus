/**
 * Integration tests for the usage repository — the meter's store.
 *
 * Run through `createTenantDb`: UsageEvent is in TENANT_SCOPED_MODELS, so
 * reads are isolated by the Prisma extension. The dedup guarantee is the
 * (tenantId, action, subjectKey) unique index, which a mocked client cannot
 * exercise.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createUsageRepository } from '../usage.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TENANT_A_SLUG = 'test-usage-a'
const TENANT_B_SLUG = 'test-usage-b'

let tenantAId: string
let tenantBId: string

afterAll(async () => {
  if (hasDb) {
    await db.usageEvent
      .deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('UsageRepository (integration)', () => {
  let scopedA: PrismaClient
  let scopedB: PrismaClient

  const event = (tenantId: string, subjectKey: string) => ({
    tenantId,
    action: 'SendSms',
    subjectKey,
    apiClientId: 'client-1',
    workflowId: 'wf-1',
    correlationId: 'corr-1',
  })

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      db.tenant.upsert({
        where: { slug: TENANT_A_SLUG },
        create: { name: 'Test Tenant (Usage A)', slug: TENANT_A_SLUG },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: TENANT_B_SLUG },
        create: { name: 'Test Tenant (Usage B)', slug: TENANT_B_SLUG },
        update: {},
      }),
    ])
    tenantAId = a.id
    tenantBId = b.id
    const scoped = (id: string) =>
      createTenantDb(db as unknown as PrismaClient, id) as unknown as PrismaClient
    scopedA = scoped(tenantAId)
    scopedB = scoped(tenantBId)
  })

  beforeEach(async () => {
    await db.usageEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
  })

  it('records a new subject once; the same subject again is a no-op', async () => {
    const repo = createUsageRepository(scopedA)
    expect(await repo.record(event(tenantAId, 'sms:1'))).toBe(true)
    expect(await repo.record(event(tenantAId, 'sms:1'))).toBe(false)
    expect(await scopedA.usageEvent.count()).toBe(1)
  })

  it('the same subject key under another action is a separate action', async () => {
    const repo = createUsageRepository(scopedA)
    await repo.record(event(tenantAId, 'k:1'))
    await repo.record({ ...event(tenantAId, 'k:1'), action: 'SendEmail' })
    expect(await scopedA.usageEvent.count()).toBe(2)
  })

  it("tenant A's events are invisible to tenant B", async () => {
    await createUsageRepository(scopedA).record(event(tenantAId, 'sms:1'))
    // Tenant B may use the same subject key — the unique key is per tenant.
    expect(await createUsageRepository(scopedB).record(event(tenantBId, 'sms:1'))).toBe(true)
    expect(await scopedA.usageEvent.count()).toBe(1)
    expect(await scopedB.usageEvent.findMany()).toEqual([
      expect.objectContaining({ tenantId: tenantBId, subjectKey: 'sms:1' }),
    ])
  })
})
