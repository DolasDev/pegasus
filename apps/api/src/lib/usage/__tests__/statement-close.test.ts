/**
 * Integration tests for the monthly usage-statement close — idempotence,
 * backfill order and overage carried across a term.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../../db'
import { createUsageRepository } from '../../../repositories/usage.repository'
import { closeTenantStatements, closeUsageStatements } from '../statement-close'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-usage-statement-close'
const NO_PLAN_SLUG = 'test-usage-statement-close-noplan'

let tenantId: string
let noPlanTenantId: string
const root = db as unknown as PrismaClient

async function clean() {
  for (const id of [tenantId, noPlanTenantId]) {
    await db.usageStatement.deleteMany({ where: { tenantId: id } })
    await db.tenantAutomationPlan.deleteMany({ where: { tenantId: id } })
    await db.usageEvent.deleteMany({ where: { tenantId: id } })
  }
}

afterAll(async () => {
  if (hasDb) {
    await clean().catch(() => undefined)
    await db.$disconnect()
  }
})

let seq = 0
async function events(tenant: string, count: number, occurredAt: string) {
  await db.usageEvent.createMany({
    data: Array.from({ length: count }, () => ({
      tenantId: tenant,
      action: 'SendSms',
      subjectKey: `close:${seq++}`,
      apiClientId: 'client-1',
      occurredAt: new Date(occurredAt),
    })),
  })
}

/** A Starter-priced plan with a tiny pool so overage is easy to reach. */
async function plan(pool: number, termStart: string, effectiveFrom = termStart, monthly = 30_000) {
  const termEnd = `${Number(termStart.slice(0, 4)) + 1}${termStart.slice(4)}`
  await createUsageRepository(root).createPlan(
    tenantId,
    {
      planCode: pool > 10 ? 'GROWTH' : 'STARTER',
      monthlyPriceCents: monthly,
      annualPoolActions: pool,
      overageCentsPerAction: 30,
      termStart,
      termEnd,
      effectiveFrom,
    },
    'test',
  )
}

describe.skipIf(!hasDb)('usage statement close (integration)', () => {
  beforeAll(async () => {
    const [t, n] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG },
        create: { name: 'Test Tenant (Statement Close)', slug: SLUG },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: NO_PLAN_SLUG },
        create: { name: 'Test Tenant (Statement Close, no plan)', slug: NO_PLAN_SLUG },
        update: {},
      }),
    ])
    tenantId = t.id
    noPlanTenantId = n.id
  })

  beforeEach(clean)

  it('closes every fully-past month in order, carrying overage, and is idempotent', async () => {
    await plan(5, '2026-07-01')
    await events(tenantId, 3, '2026-07-10T00:00:00Z') // 3 of 5
    await events(tenantId, 4, '2026-08-31T23:59:00Z') // 7 → 2 over
    await events(tenantId, 2, '2026-09-02T00:00:00Z') // 9 → 2 more over
    await events(tenantId, 50, '2026-10-01T00:00:00Z') // the current month: not closed
    await events(noPlanTenantId, 5, '2026-08-10T00:00:00Z')

    const first = await closeTenantStatements(root, tenantId, '2026-10-02')
    expect(first).toEqual(['2026-07', '2026-08', '2026-09'])

    const statements = await createUsageRepository(root).listStatements(tenantId)
    const byMonth = Object.fromEntries(statements.map((s) => [s.periodMonth, s]))
    expect(byMonth['2026-07']).toMatchObject({
      actionsInMonth: 3,
      termToDateActions: 3,
      overageActions: 0,
      totalCents: 30_000,
    })
    expect(byMonth['2026-08']).toMatchObject({
      actionsInMonth: 4,
      termToDateActions: 7,
      overageActions: 2,
      overageCents: 60,
      totalCents: 30_060,
    })
    expect(byMonth['2026-09']).toMatchObject({ termToDateActions: 9, overageActions: 2 })

    // A re-run (the next day's) writes nothing and changes nothing.
    expect(await closeTenantStatements(root, tenantId, '2026-10-03')).toEqual([])
    expect(await createUsageRepository(root).listStatements(tenantId)).toEqual(statements)
  })

  it('pro-rates a mid-month upgrade and applies its pool to the whole term', async () => {
    await plan(5, '2026-07-01')
    await plan(1_000, '2026-07-01', '2026-07-16', 65_000)
    await events(tenantId, 20, '2026-07-05T00:00:00Z')

    await closeTenantStatements(root, tenantId, '2026-08-01')
    const july = await createUsageRepository(root).findStatement(tenantId, '2026-07')
    expect(july).toMatchObject({
      planCode: 'GROWTH',
      pool: 1_000,
      overageActions: 0,
      proRatedPlanCents: Math.round((15 * 30_000 + 16 * 65_000) / 31),
    })
  })

  it('across tenants: skips tenants with no plan and reports what it wrote', async () => {
    await plan(5, '2026-07-01')
    const result = await closeUsageStatements(root, '2026-08-05')
    expect(result.failures).toEqual([])
    expect(result.statementsWritten).toContainEqual({ tenantId, periodMonth: '2026-07' })
    expect(result.statementsWritten.some((s) => s.tenantId === noPlanTenantId)).toBe(false)
  })

  it('writes nothing before the first term or for the month in progress', async () => {
    await plan(5, '2026-07-01')
    expect(await closeTenantStatements(root, tenantId, '2026-07-20')).toEqual([])
  })
})
