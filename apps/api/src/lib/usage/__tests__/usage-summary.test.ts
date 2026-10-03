/**
 * Integration tests for the usage summary — windows, breakdowns, projection.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../../db'
import { createTenantDb } from '../../prisma'
import { createUsageRepository } from '../../../repositories/usage.repository'
import { buildUsageSummary } from '../usage-summary'
import { termEndFor, AUTOMATION_PLAN_CATALOG, type AutomationPlanCode } from '@pegasus/domain'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-usage-summary'
const OTHER_SLUG = 'test-usage-summary-other'

let tenantId: string
let otherTenantId: string
let workflowId: string
let scoped: PrismaClient

async function clean() {
  for (const id of [tenantId, otherTenantId]) {
    await db.tenantAutomationPlan.deleteMany({ where: { tenantId: id } })
    await db.usageEvent.deleteMany({ where: { tenantId: id } })
  }
}

afterAll(async () => {
  if (hasDb) {
    await clean().catch(() => undefined)
    await db.workflow.deleteMany({ where: { id: workflowId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

let seq = 0
async function event(tenant: string, action: string, occurredAt: string, wf: string | null = null) {
  await db.usageEvent.create({
    data: {
      tenantId: tenant,
      action,
      subjectKey: `k:${seq++}`,
      apiClientId: 'client-1',
      workflowId: wf,
      occurredAt: new Date(occurredAt),
    },
  })
}

async function plan(code: AutomationPlanCode, termStart: string, effectiveFrom = termStart) {
  await createUsageRepository(db as unknown as PrismaClient).createPlan(
    tenantId,
    {
      planCode: code,
      ...AUTOMATION_PLAN_CATALOG[code],
      termStart,
      termEnd: termEndFor(termStart),
      effectiveFrom,
    },
    'test',
  )
}

describe.skipIf(!hasDb)('buildUsageSummary (integration)', () => {
  beforeAll(async () => {
    const [t, o] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG },
        create: { name: 'Test Tenant (Usage Summary)', slug: SLUG },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: OTHER_SLUG },
        create: { name: 'Test Tenant (Usage Summary Other)', slug: OTHER_SLUG },
        update: {},
      }),
    ])
    tenantId = t.id
    otherTenantId = o.id
    scoped = createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient
    await db.workflow.deleteMany({ where: { tenantId, name: 'nw_pulse_texting' } })
    const wf = await db.workflow.create({
      data: {
        tenantId,
        name: 'nw_pulse_texting',
        version: '0.0.1-usage-summary-test',
        artifactKey: 'test/usage-summary.zip',
        manifest: {},
        createdByUserId: 'test',
      },
    })
    workflowId = wf.id
  })

  beforeEach(clean)

  it('with no plan, counts the calendar year and has no pool', async () => {
    await event(tenantId, 'SendSms', '2026-03-05T10:00:00Z', null)
    await event(tenantId, 'SendSms', '2025-12-31T23:59:59Z', null) // previous year
    const s = await buildUsageSummary(scoped, tenantId, { today: '2026-06-15' })
    expect(s).toMatchObject({
      plan: null,
      termStart: '2026-01-01',
      termEnd: '2027-01-01',
      pool: null,
      remaining: null,
      usedTermToDate: 1,
      overageActions: 0,
    })
    expect(s.byMonth).toHaveLength(12)
    expect(s.byMonth.find((m) => m.month === '2026-03')?.actions).toBe(1)
  })

  it('with a plan, counts the term and breaks it down by month, action and workflow', async () => {
    await plan('STARTER', '2026-10-01')
    await event(tenantId, 'SendSms', '2026-10-02T12:00:00Z', workflowId)
    await event(tenantId, 'SendSms', '2026-11-02T12:00:00Z', workflowId)
    await event(tenantId, 'UpdateTextMessage', '2026-11-03T12:00:00Z', workflowId)
    await event(tenantId, 'DeliverToExternal', '2026-11-04T12:00:00Z', null)
    await event(tenantId, 'SendSms', '2026-09-30T23:00:00Z', workflowId) // before the term
    await event(otherTenantId, 'SendSms', '2026-10-05T12:00:00Z', null) // another tenant

    const s = await buildUsageSummary(scoped, tenantId, { today: '2026-11-15' })
    expect(s).toMatchObject({
      plan: { planCode: 'STARTER', name: 'Starter', annualPoolActions: 6_000 },
      termStart: '2026-10-01',
      termEnd: '2027-10-01',
      pool: 6_000,
      usedTermToDate: 4,
      remaining: 5_996,
    })
    expect(s.byMonth.slice(0, 2)).toEqual([
      { month: '2026-10', actions: 1 },
      { month: '2026-11', actions: 3 },
    ])
    expect(s.byMonth).toHaveLength(12)
    expect(s.byAction).toEqual([
      { action: 'SendSms', actions: 2 },
      { action: 'DeliverToExternal', actions: 1 },
      { action: 'UpdateTextMessage', actions: 1 },
    ])
    expect(s.byWorkflow).toEqual([
      { workflowId, workflowName: 'nw_pulse_texting', actions: 3 },
      { workflowId: null, workflowName: null, actions: 1 },
    ])
    // 46 days elapsed of 365 → 4 × 365 / 46 ≈ 32.
    expect(s.projectedAtTermEnd).toBe(32)
  })

  it('reports overage once the pool is passed', async () => {
    await createUsageRepository(db as unknown as PrismaClient).createPlan(
      tenantId,
      {
        planCode: 'STARTER',
        monthlyPriceCents: 30_000,
        annualPoolActions: 2,
        overageCentsPerAction: 30,
        termStart: '2026-10-01',
        termEnd: '2027-10-01',
        effectiveFrom: '2026-10-01',
      },
      'test',
    )
    for (let i = 0; i < 3; i++) await event(tenantId, 'SendSms', '2026-10-10T00:00:00Z')
    const s = await buildUsageSummary(scoped, tenantId, { today: '2026-10-20' })
    expect(s).toMatchObject({ usedTermToDate: 3, remaining: 0, overageActions: 1 })
  })

  it('shows the upgraded plan for the whole term, and a past term by year', async () => {
    await plan('STARTER', '2025-10-01')
    await plan('GROWTH', '2025-10-01', '2026-03-01')
    await plan('SCALE', '2026-10-01')
    await event(tenantId, 'SendSms', '2026-01-10T00:00:00Z')

    const past = await buildUsageSummary(scoped, tenantId, { today: '2026-11-01', year: 2025 })
    expect(past).toMatchObject({
      plan: { planCode: 'GROWTH' },
      termStart: '2025-10-01',
      termEnd: '2026-10-01',
      pool: 15_000,
      usedTermToDate: 1,
      projectedAtTermEnd: null, // the term is over
    })

    const current = await buildUsageSummary(scoped, tenantId, { today: '2026-11-01' })
    expect(current).toMatchObject({ plan: { planCode: 'SCALE' }, usedTermToDate: 0 })
  })
})
