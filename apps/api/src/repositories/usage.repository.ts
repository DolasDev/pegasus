// ---------------------------------------------------------------------------
// Usage repository — the billable-action meter's store (UsageEvent), the
// tenant's automation plan history (TenantAutomationPlan) and the closed
// monthly statements (UsageStatement).
//
// The unique (tenantId, action, subjectKey) index is the meter's own dedup:
// the same subject recorded twice is one action. `createMany` with
// `skipDuplicates` makes a duplicate a silent no-op instead of a P2002 — never
// call it inside an interactive transaction regardless (a unique violation
// aborts the whole Postgres transaction; the #730 lesson).
//
// Every query names `tenantId` explicitly, so the same repository serves the
// tenant-scoped client (tenant routes; the extension then double-scopes reads)
// and the root client (admin routes and the cross-tenant close cron). Creates
// are never rewritten by the extension, so they set it themselves.
//
// Plan and statement dates are Postgres DATEs: Prisma hands them over as UTC
// midnight, so `.toISOString().slice(0, 10)` is the calendar date. Months are
// UTC calendar months.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'
import type { AutomationPlanCode, AutomationPlanPeriod, UsageStatementLines } from '@pegasus/domain'

export interface RecordUsageInput {
  tenantId: string
  action: string
  subjectKey: string
  apiClientId: string
  workflowId: string | null
  correlationId: string | null
}

/** A half-open [from, to) window of UTC calendar dates (YYYY-MM-DD). */
export interface DateWindow {
  from: string
  to: string
}

export interface AutomationPlanRow extends AutomationPlanPeriod {
  id: string
  createdAt: Date
  createdBy: string
}

export interface UsageStatementRow extends UsageStatementLines {
  id: string
  closedAt: Date
}

const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`)
const toIso = (d: Date): string => d.toISOString().slice(0, 10)

function occurredIn(tenantId: string, w: DateWindow) {
  return { tenantId, occurredAt: { gte: toDate(w.from), lt: toDate(w.to) } }
}

type PlanRecord = Prisma.TenantAutomationPlanGetPayload<object>
type StatementRecord = Prisma.UsageStatementGetPayload<object>

function toPlanRow(r: PlanRecord): AutomationPlanRow {
  return {
    id: r.id,
    planCode: r.planCode as AutomationPlanCode,
    monthlyPriceCents: r.monthlyPriceCents,
    annualPoolActions: r.annualPoolActions,
    overageCentsPerAction: r.overageCentsPerAction,
    termStart: toIso(r.termStart),
    termEnd: toIso(r.termEnd),
    effectiveFrom: toIso(r.effectiveFrom),
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  }
}

function toStatementRow(r: StatementRecord): UsageStatementRow {
  return {
    id: r.id,
    periodMonth: r.periodMonth,
    planCode: r.planCode as AutomationPlanCode,
    termStart: toIso(r.termStart),
    termEnd: toIso(r.termEnd),
    monthlyPriceCents: r.monthlyPriceCents,
    proRatedPlanCents: r.proRatedPlanCents,
    actionsInMonth: r.actionsInMonth,
    termToDateActions: r.termToDateActions,
    pool: r.pool,
    overageActions: r.overageActions,
    overageCentsPerAction: r.overageCentsPerAction,
    overageCents: r.overageCents,
    totalCents: r.totalCents,
    closedAt: r.closedAt,
  }
}

export function createUsageRepository(db: PrismaClient) {
  return {
    // ── Meter ───────────────────────────────────────────────────────────────

    /** Record one billable action. Returns false when the subject was already counted. */
    async record(input: RecordUsageInput): Promise<boolean> {
      const { count } = await db.usageEvent.createMany({
        data: [input],
        skipDuplicates: true,
      })
      return count === 1
    },

    async countActions(tenantId: string, w: DateWindow): Promise<number> {
      return db.usageEvent.count({ where: occurredIn(tenantId, w) })
    },

    /** Actions per UTC calendar month, months with none omitted. */
    async countByMonth(
      tenantId: string,
      w: DateWindow,
    ): Promise<Array<{ month: string; actions: number }>> {
      const rows = await db.$queryRaw<Array<{ month: string; actions: bigint }>>(Prisma.sql`
        SELECT to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS month,
               count(*) AS actions
        FROM usage_events
        WHERE tenant_id = ${tenantId}
          AND occurred_at >= ${toDate(w.from)}
          AND occurred_at < ${toDate(w.to)}
        GROUP BY 1
        ORDER BY 1
      `)
      return rows.map((r) => ({ month: r.month, actions: Number(r.actions) }))
    },

    async countByAction(
      tenantId: string,
      w: DateWindow,
    ): Promise<Array<{ action: string; actions: number }>> {
      const rows = await db.usageEvent.groupBy({
        by: ['action'],
        where: occurredIn(tenantId, w),
        _count: { _all: true },
      })
      return rows
        .map((r) => ({ action: r.action, actions: r._count._all }))
        .sort((a, b) => b.actions - a.actions || a.action.localeCompare(b.action))
    },

    /** Per workflow; `workflowId: null` is every plain (non-workflow) API client. */
    async countByWorkflow(
      tenantId: string,
      w: DateWindow,
    ): Promise<Array<{ workflowId: string | null; actions: number }>> {
      const rows = await db.usageEvent.groupBy({
        by: ['workflowId'],
        where: occurredIn(tenantId, w),
        _count: { _all: true },
      })
      return rows
        .map((r) => ({ workflowId: r.workflowId, actions: r._count._all }))
        .sort((a, b) => b.actions - a.actions)
    },

    // ── Plans ───────────────────────────────────────────────────────────────

    async listPlans(tenantId: string): Promise<AutomationPlanRow[]> {
      const rows = await db.tenantAutomationPlan.findMany({
        where: { tenantId },
        orderBy: [{ termStart: 'asc' }, { effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      })
      return rows.map(toPlanRow)
    },

    async createPlan(
      tenantId: string,
      plan: AutomationPlanPeriod,
      createdBy: string,
    ): Promise<AutomationPlanRow> {
      const row = await db.tenantAutomationPlan.create({
        data: {
          tenantId,
          planCode: plan.planCode,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPoolActions: plan.annualPoolActions,
          overageCentsPerAction: plan.overageCentsPerAction,
          termStart: toDate(plan.termStart),
          termEnd: toDate(plan.termEnd),
          effectiveFrom: toDate(plan.effectiveFrom),
          createdBy,
        },
      })
      return toPlanRow(row)
    },

    /** Every tenant that has ever had a plan (the close cron's work list). */
    async listTenantIdsWithPlans(): Promise<string[]> {
      const rows = await db.tenantAutomationPlan.findMany({
        distinct: ['tenantId'],
        select: { tenantId: true },
      })
      return rows.map((r) => r.tenantId)
    },

    // ── Statements ──────────────────────────────────────────────────────────

    async listStatements(tenantId: string): Promise<UsageStatementRow[]> {
      const rows = await db.usageStatement.findMany({
        where: { tenantId },
        orderBy: { periodMonth: 'desc' },
      })
      return rows.map(toStatementRow)
    },

    async findStatement(tenantId: string, periodMonth: string): Promise<UsageStatementRow | null> {
      const row = await db.usageStatement.findFirst({ where: { tenantId, periodMonth } })
      return row ? toStatementRow(row) : null
    },

    /** Overage already billed on statements of the term starting `termStart`. */
    async overageBilledInTerm(tenantId: string, termStart: string): Promise<number> {
      const agg = await db.usageStatement.aggregate({
        where: { tenantId, termStart: toDate(termStart) },
        _sum: { overageActions: true },
      })
      return agg._sum.overageActions ?? 0
    },

    /**
     * Write a closed month. Immutable: a statement already there for the month
     * is left untouched, and false is returned.
     */
    async createStatement(tenantId: string, lines: UsageStatementLines): Promise<boolean> {
      const { count } = await db.usageStatement.createMany({
        data: [
          {
            tenantId,
            periodMonth: lines.periodMonth,
            planCode: lines.planCode,
            termStart: toDate(lines.termStart),
            termEnd: toDate(lines.termEnd),
            monthlyPriceCents: lines.monthlyPriceCents,
            proRatedPlanCents: lines.proRatedPlanCents,
            actionsInMonth: lines.actionsInMonth,
            termToDateActions: lines.termToDateActions,
            pool: lines.pool,
            overageActions: lines.overageActions,
            overageCentsPerAction: lines.overageCentsPerAction,
            overageCents: lines.overageCents,
            totalCents: lines.totalCents,
          },
        ],
        skipDuplicates: true,
      })
      return count === 1
    },
  }
}

export type UsageRepository = ReturnType<typeof createUsageRepository>
