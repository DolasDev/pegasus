// ---------------------------------------------------------------------------
// Admin tenant usage handler — /api/admin/tenants/:tenantId/{automation-plan,usage}
//
// Plan assignment and the usage view for any tenant, operated by a Cognito
// PLATFORM_ADMIN (admin-web tenant detail → Usage).
//
//   GET  /automation-plan                current plan, full history, catalog
//   POST /automation-plan                assign: a new term, a renewal, or a
//                                        mid-term upgrade (rules in
//                                        @pegasus/domain validatePlanChange)
//   GET  /usage?year=YYYY                the same summary the tenant sees
//   GET  /usage/statements               closed monthly statements, newest first
//   GET  /usage/statements/:periodMonth  one statement; ?format=csv to export
//
// Auth: enforced by adminAuthMiddleware on the parent router.
// DB:   basePrisma (unscoped) — every query names tenantId explicitly.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import {
  AUTOMATION_PLAN_CATALOG,
  AUTOMATION_PLAN_CODES,
  isPeriodMonth,
  planInEffect,
  termEndFor,
  validatePlanChange,
  type AutomationPlanPeriod,
} from '@pegasus/domain'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { writeAuditLog } from './audit'
import {
  createUsageRepository,
  type AutomationPlanRow,
  type UsageStatementRow,
} from '../../repositories/usage.repository'
import { buildUsageSummary } from '../../lib/usage/usage-summary'
import { SummaryQuery } from '../usage'

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const CENTS = z.number().int().min(0).max(100_000_000)

const AssignPlanBody = z
  .object({
    planCode: z.enum(AUTOMATION_PLAN_CODES),
    /** The 1st of a month. For an upgrade, the current term's start. */
    termStart: ISO_DATE,
    /** Defaults to termStart. A mid-term upgrade takes effect on this day. */
    effectiveFrom: ISO_DATE.optional(),
    /** Default to the published catalog; override for an escalated renewal or a bespoke deal. */
    monthlyPriceCents: CENTS.optional(),
    annualPoolActions: z.number().int().min(0).max(100_000_000).optional(),
    overageCentsPerAction: CENTS.optional(),
  })
  .strict()

export const adminTenantUsageRouter = new Hono<AdminEnv>()

const rootDb = db as unknown as PrismaClient

function reqMeta(c: Context<AdminEnv>) {
  return {
    adminSub: c.get('adminSub'),
    adminEmail: c.get('adminEmail'),
    ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  }
}

async function tenantExists(tenantId: string): Promise<boolean> {
  return (await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) !== null
}

function planDto(row: AutomationPlanRow) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function statementDto(row: UsageStatementRow) {
  return { ...row, closedAt: row.closedAt.toISOString() }
}

const CSV_COLUMNS = [
  'periodMonth',
  'planCode',
  'termStart',
  'termEnd',
  'monthlyPriceCents',
  'proRatedPlanCents',
  'actionsInMonth',
  'termToDateActions',
  'pool',
  'overageActions',
  'overageCentsPerAction',
  'overageCents',
  'totalCents',
  'closedAt',
] as const

/** Every value is a number, a plan code, or an ISO date — nothing needs quoting. */
function statementCsv(tenantId: string, row: UsageStatementRow): string {
  const dto = statementDto(row)
  const values = CSV_COLUMNS.map((col) => String(dto[col]))
  return `tenantId,${CSV_COLUMNS.join(',')}\n${tenantId},${values.join(',')}\n`
}

// ── Plan ──────────────────────────────────────────────────────────────────────

adminTenantUsageRouter.get('/automation-plan', async (c) => {
  const tenantId = c.req.param('tenantId') ?? ''
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const history = await createUsageRepository(rootDb).listPlans(tenantId)
  const today = new Date().toISOString().slice(0, 10)
  const current = planInEffect(history, today)
  return c.json({
    data: {
      current: current ? planDto(current) : null,
      history: history.map(planDto),
      catalog: Object.values(AUTOMATION_PLAN_CATALOG),
    },
  })
})

adminTenantUsageRouter.post(
  '/automation-plan',
  validator('json', (value, c) => {
    const r = AssignPlanBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.req.param('tenantId') ?? ''
    if (!(await tenantExists(tenantId))) {
      return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
    }
    const body = c.req.valid('json')
    const catalog = AUTOMATION_PLAN_CATALOG[body.planCode]
    const proposed: AutomationPlanPeriod = {
      planCode: body.planCode,
      monthlyPriceCents: body.monthlyPriceCents ?? catalog.monthlyPriceCents,
      annualPoolActions: body.annualPoolActions ?? catalog.annualPoolActions,
      overageCentsPerAction: body.overageCentsPerAction ?? catalog.overageCentsPerAction,
      termStart: body.termStart,
      termEnd: termEndFor(body.termStart),
      effectiveFrom: body.effectiveFrom ?? body.termStart,
    }
    const { adminSub, adminEmail, ipAddress, userAgent } = reqMeta(c)

    // Validate against the history read inside the same transaction, so two
    // concurrent assignments can't both pass against a stale view.
    const outcome = await db.$transaction(async (tx) => {
      const repo = createUsageRepository(tx as unknown as PrismaClient)
      const history = await repo.listPlans(tenantId)
      const error = validatePlanChange(history, proposed)
      if (error) return { error } as const
      const created = await repo.createPlan(tenantId, proposed, adminEmail)
      await writeAuditLog(
        tx,
        adminSub,
        adminEmail,
        'ASSIGN_AUTOMATION_PLAN',
        'TENANT',
        tenantId,
        null,
        { ...proposed, id: created.id },
        ipAddress,
        userAgent,
      )
      return { created } as const
    })

    if ('error' in outcome) {
      return c.json({ error: outcome.error, code: 'INVALID_PLAN_CHANGE' }, 422)
    }
    return c.json({ data: planDto(outcome.created) }, 201)
  },
)

// ── Usage ─────────────────────────────────────────────────────────────────────

adminTenantUsageRouter.get(
  '/usage',
  validator('query', (value, c) => {
    const r = SummaryQuery.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.req.param('tenantId') ?? ''
    if (!(await tenantExists(tenantId))) {
      return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
    }
    const { year } = c.req.valid('query')
    const summary = await buildUsageSummary(rootDb, tenantId, {
      ...(year !== undefined ? { year } : {}),
    })
    return c.json({ data: summary })
  },
)

adminTenantUsageRouter.get('/usage/statements', async (c) => {
  const tenantId = c.req.param('tenantId') ?? ''
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const rows = await createUsageRepository(rootDb).listStatements(tenantId)
  return c.json({ data: rows.map(statementDto) })
})

adminTenantUsageRouter.get('/usage/statements/:periodMonth', async (c) => {
  const tenantId = c.req.param('tenantId') ?? ''
  const periodMonth = c.req.param('periodMonth')
  if (!isPeriodMonth(periodMonth)) {
    return c.json({ error: 'periodMonth must be YYYY-MM', code: 'VALIDATION_ERROR' }, 400)
  }
  if (!(await tenantExists(tenantId))) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  const row = await createUsageRepository(rootDb).findStatement(tenantId, periodMonth)
  if (!row) {
    return c.json({ error: `No statement for ${periodMonth}`, code: 'NOT_FOUND' }, 404)
  }
  if (c.req.query('format') === 'csv') {
    return c.body(statementCsv(tenantId, row), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="usage-statement-${tenantId}-${periodMonth}.csv"`,
    })
  }
  return c.json({ data: statementDto(row) })
})
