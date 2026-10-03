// ---------------------------------------------------------------------------
// E2E coverage for the usage meter + summary (plans/completed/usage-metering.md).
//
// The local API runs with SKIP_AUTH, under which dual-auth makes EVERY caller —
// a `vnd_` key included — a synthetic human tenant_admin. So this spec proves
// the human side over real HTTP:
//
//   1. A person closing a task (CloseTask, a billable route) counts nothing.
//   2. GET /api/v1/usage/summary serves the full shape, and a plan assigned to
//      the tenant (seeded as the admin route would write it) is reflected.
//
// The workflow-runtime side — a real `vnd_` key metered, a replay free, a
// failed call free, attribution to the workflow — runs through the real m2m
// stack in apps/api/src/__tests__/usage-meter.integration.test.ts.
//
// @local-only: needs DB seeding and the SKIP_AUTH webServer.
// ---------------------------------------------------------------------------

import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const DATABASE_URL = process.env['DATABASE_URL']
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  $disconnect: () => Promise<void>
}

async function getPrisma(): Promise<PrismaLike> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 ESM export compat (mirrors other specs).
  const mod: Record<string, any> = await import('@prisma/client')
  const PrismaClient = mod['PrismaClient'] ?? mod['default']?.PrismaClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter ESM export compat
  const adapterMod: Record<string, any> = await import('@prisma/adapter-pg')
  const PrismaPg = adapterMod['PrismaPg'] ?? adapterMod['default']?.PrismaPg
  const adapter = new PrismaPg({ connectionString: DATABASE_URL })
  return new PrismaClient({ adapter }) as PrismaLike
}

type Summary = {
  plan: { planCode: string; name: string; annualPoolActions: number } | null
  termStart: string
  termEnd: string
  pool: number | null
  usedTermToDate: number
  remaining: number | null
  byMonth: Array<{ month: string; actions: number }>
  byAction: Array<{ action: string; actions: number }>
  byWorkflow: Array<{ workflowId: string | null; actions: number }>
}

test.describe.serial('Usage meter + summary — the human side @local-only', () => {
  let prisma: PrismaLike
  const planId = `e2e-plan-${Date.now().toString(36)}`
  const termStart = `${new Date().toISOString().slice(0, 7)}-01`

  const tenantEvents = async (): Promise<number> => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM public.usage_events WHERE tenant_id = $1`,
      TENANT_ID,
    )
    return Number(rows[0]?.n ?? 0)
  }

  test.beforeAll(async () => {
    prisma = await getPrisma()
    await prisma.$executeRawUnsafe(
      `DELETE FROM public.tenant_automation_plans WHERE tenant_id = $1`,
      TENANT_ID,
    )
  })

  test.afterAll(async () => {
    await prisma
      .$executeRawUnsafe(`DELETE FROM public.tenant_automation_plans WHERE id = $1`, planId)
      .catch(() => {})
    await prisma.$disconnect()
  })

  test('a person closing a task counts nothing', async ({ apiFetch }) => {
    const before = await tenantEvents()
    const res = await apiFetch('/api/v1/pegii/tasks/close', {
      method: 'POST',
      body: JSON.stringify({
        orderId: `e2e-usage-${Date.now().toString(36)}`,
        taskType: 'date_confirmation',
      }),
    })
    expect(res.status).toBe(200)
    expect(await tenantEvents()).toBe(before)
  })

  test('with no plan, the summary covers the calendar year with no pool', async ({ apiFetch }) => {
    const res = await apiFetch('/api/v1/usage/summary')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: Summary }
    const year = new Date().toISOString().slice(0, 4)
    expect(data.plan).toBeNull()
    expect(data.pool).toBeNull()
    expect(data.termStart).toBe(`${year}-01-01`)
    expect(data.byMonth).toHaveLength(12)
    expect(Array.isArray(data.byAction)).toBe(true)
    expect(Array.isArray(data.byWorkflow)).toBe(true)
  })

  test('an assigned plan is reflected in the summary', async ({ apiFetch }) => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.tenant_automation_plans
         (id, tenant_id, plan_code, monthly_price_cents, annual_pool_actions,
          overage_cents_per_action, term_start, term_end, effective_from, created_by)
       VALUES ($1, $2, 'SCALE', 120000, 50000, 30, $3::date,
               ($3::date + interval '1 year')::date, $3::date, 'e2e')`,
      planId,
      TENANT_ID,
      termStart,
    )
    const res = await apiFetch('/api/v1/usage/summary')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: Summary }
    expect(data.plan).toMatchObject({ planCode: 'SCALE', name: 'Scale', annualPoolActions: 50_000 })
    expect(data.termStart).toBe(termStart)
    expect(data.pool).toBe(50_000)
    expect(data.remaining).toBe(50_000 - data.usedTermToDate)
  })

  test('a malformed year is rejected', async ({ apiFetch }) => {
    expect((await apiFetch('/api/v1/usage/summary?year=abc')).status).toBe(400)
  })
})
