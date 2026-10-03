/**
 * Integration tests for the admin tenant usage routes
 * (/api/admin/tenants/:tenantId/{automation-plan,usage}).
 *
 * Run against a real database: plan assignment validates against history read
 * inside a transaction and writes an audit row, which a mocked client cannot
 * exercise. The PLATFORM_ADMIN gate is adminAuthMiddleware's (covered by
 * __tests__/admin-auth.test.ts); buildApp() injects the admin identity.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { adminTenantsRouter } from './tenants'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-admin-tenant-usage'
const ADMIN_EMAIL = 'admin@platform.com'

let tenantId: string

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', ADMIN_EMAIL)
    await next()
  })
  app.route('/tenants', adminTenantsRouter)
  return app
}

async function clean() {
  await db.usageStatement.deleteMany({ where: { tenantId } })
  await db.tenantAutomationPlan.deleteMany({ where: { tenantId } })
  await db.usageEvent.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (hasDb) {
    await clean().catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('admin tenant usage routes (integration)', () => {
  beforeAll(async () => {
    const t = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Test Tenant (Admin Usage)', slug: SLUG },
      update: {},
    })
    tenantId = t.id
  })

  beforeEach(clean)

  it('assigns a first term from the catalog, and records who did it', async () => {
    const app = buildApp()
    const res = await app.request(
      `/tenants/${tenantId}/automation-plan`,
      post({ planCode: 'STARTER', termStart: '2026-10-01' }),
    )
    expect(res.status).toBe(201)
    expect((await json(res))['data']).toMatchObject({
      planCode: 'STARTER',
      monthlyPriceCents: 30_000,
      annualPoolActions: 6_000,
      overageCentsPerAction: 30,
      termStart: '2026-10-01',
      termEnd: '2027-10-01',
      effectiveFrom: '2026-10-01',
      createdBy: ADMIN_EMAIL,
    })

    const audit = await db.auditLog.findFirst({
      where: { action: 'ASSIGN_AUTOMATION_PLAN', resourceId: tenantId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit?.adminEmail).toBe(ADMIN_EMAIL)

    const got = await json(await app.request(`/tenants/${tenantId}/automation-plan`))
    const data = got['data'] as JsonBody
    expect(data['history']).toHaveLength(1)
    expect(data['catalog']).toHaveLength(3)
  })

  it('accepts a mid-term upgrade and refuses a mid-term downgrade with 422', async () => {
    const app = buildApp()
    const url = `/tenants/${tenantId}/automation-plan`
    await app.request(url, post({ planCode: 'GROWTH', termStart: '2026-10-01' }))

    const up = await app.request(
      url,
      post({ planCode: 'SCALE', termStart: '2026-10-01', effectiveFrom: '2027-02-10' }),
    )
    expect(up.status).toBe(201)

    const down = await app.request(
      url,
      post({ planCode: 'STARTER', termStart: '2026-10-01', effectiveFrom: '2027-03-01' }),
    )
    expect(down.status).toBe(422)
    expect(await json(down)).toMatchObject({ code: 'INVALID_PLAN_CHANGE' })
    expect(await db.tenantAutomationPlan.count({ where: { tenantId } })).toBe(2)
  })

  it('takes escalated prices as an override', async () => {
    const res = await buildApp().request(
      `/tenants/${tenantId}/automation-plan`,
      post({
        planCode: 'SCALE',
        termStart: '2026-10-01',
        monthlyPriceCents: 124_800,
        overageCentsPerAction: 31,
      }),
    )
    expect((await json(res))['data']).toMatchObject({
      monthlyPriceCents: 124_800,
      annualPoolActions: 50_000,
      overageCentsPerAction: 31,
    })
  })

  it('400s an unknown plan code and 404s an unknown tenant', async () => {
    const app = buildApp()
    const bad = await app.request(
      `/tenants/${tenantId}/automation-plan`,
      post({ planCode: 'ENTERPRISE', termStart: '2026-10-01' }),
    )
    expect(bad.status).toBe(400)
    // Shaped like a date but impossible: a 400, not a 500 from termEndFor().
    const impossible = await app.request(
      `/tenants/${tenantId}/automation-plan`,
      post({ planCode: 'STARTER', termStart: '2026-13-01' }),
    )
    expect(impossible.status).toBe(400)
    const missing = await app.request(
      '/tenants/00000000-0000-0000-0000-000000000000/automation-plan',
    )
    expect(missing.status).toBe(404)
  })

  it('serves the usage summary for any tenant', async () => {
    const res = await buildApp().request(`/tenants/${tenantId}/usage?year=2026`)
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ plan: null, usedTermToDate: 0 })
  })

  it('lists statements and exports one as CSV', async () => {
    await db.usageStatement.create({
      data: {
        tenantId,
        periodMonth: '2026-10',
        planCode: 'STARTER',
        termStart: new Date('2026-10-01T00:00:00Z'),
        termEnd: new Date('2027-10-01T00:00:00Z'),
        monthlyPriceCents: 30_000,
        proRatedPlanCents: 30_000,
        actionsInMonth: 412,
        termToDateActions: 412,
        pool: 6_000,
        overageActions: 0,
        overageCentsPerAction: 30,
        overageCents: 0,
        totalCents: 30_000,
      },
    })
    const app = buildApp()

    const list = await json(await app.request(`/tenants/${tenantId}/usage/statements`))
    expect(list['data']).toEqual([expect.objectContaining({ periodMonth: '2026-10' })])

    const csv = await app.request(`/tenants/${tenantId}/usage/statements/2026-10?format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/)
    const [header, line] = (await csv.text()).trim().split('\n')
    expect(header).toMatch(/^tenantId,periodMonth,planCode,/)
    expect(line).toContain(`${tenantId},2026-10,STARTER,2026-10-01,2027-10-01,30000,30000,412,`)

    expect((await app.request(`/tenants/${tenantId}/usage/statements/2026-11`)).status).toBe(404)
    expect((await app.request(`/tenants/${tenantId}/usage/statements/2026-1`)).status).toBe(400)
  })
})
