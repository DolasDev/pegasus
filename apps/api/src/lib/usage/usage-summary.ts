// ---------------------------------------------------------------------------
// The usage summary — one shape for the tenant route (GET /api/v1/usage/summary),
// the admin route (GET /api/admin/tenants/:id/usage), the tenant-web Usage page
// and the SDK's get_usage_summary().
//
// Window:
//   - no `year`: the term in effect today; with no plan, the current calendar
//     year (so usage is visible before a plan is assigned).
//   - `year`:   the latest term starting in that year; with none, that
//     calendar year.
// All dates are UTC calendar dates.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import {
  AUTOMATION_PLAN_CATALOG,
  addDays,
  addMonths,
  planInEffect,
  projectTermUsage,
} from '@pegasus/domain'
import { createUsageRepository, type AutomationPlanRow } from '../../repositories/usage.repository'

export interface UsageSummary {
  plan: {
    planCode: string
    name: string
    monthlyPriceCents: number
    annualPoolActions: number
    overageCentsPerAction: number
    effectiveFrom: string
  } | null
  /** The window counted: the plan term, or a calendar year when no plan applies. */
  termStart: string
  termEnd: string
  pool: number | null
  usedTermToDate: number
  remaining: number | null
  /** Actions beyond the pool so far this term (billed at the overage rate). */
  overageActions: number
  /** Linear projection of the term total — an ESTIMATE. Null once the window is over. */
  projectedAtTermEnd: number | null
  asOf: string
  byMonth: Array<{ month: string; actions: number }>
  byAction: Array<{ action: string; actions: number }>
  byWorkflow: Array<{ workflowId: string | null; workflowName: string | null; actions: number }>
}

function windowFor(
  plans: readonly AutomationPlanRow[],
  today: string,
  year: number | undefined,
): { termStart: string; termEnd: string; plan: AutomationPlanRow | null } {
  if (year === undefined) {
    const active = planInEffect(plans, today)
    if (active) return { termStart: active.termStart, termEnd: active.termEnd, plan: active }
    const y = today.slice(0, 4)
    return { termStart: `${y}-01-01`, termEnd: `${Number(y) + 1}-01-01`, plan: null }
  }
  const inYear = plans.filter((p) => p.termStart.startsWith(`${year}-`))
  const termStart = inYear
    .map((p) => p.termStart)
    .sort()
    .at(-1)
  if (!termStart) return { termStart: `${year}-01-01`, termEnd: `${year + 1}-01-01`, plan: null }
  const termRows = inYear.filter((p) => p.termStart === termStart)
  const termEnd = termRows[0]!.termEnd
  // The row in effect at the last day counted: today, or the term's last day.
  const at = today < termEnd ? (today < termStart ? termStart : today) : addDays(termEnd, -1)
  return { termStart, termEnd, plan: planInEffect(termRows, at) }
}

function monthsOf(termStart: string, termEnd: string): string[] {
  const months: string[] = []
  for (let m = `${termStart.slice(0, 7)}-01`; m < termEnd; m = addMonths(m, 1)) {
    months.push(m.slice(0, 7))
  }
  return months
}

export async function buildUsageSummary(
  db: PrismaClient,
  tenantId: string,
  opts: { year?: number; today?: string } = {},
): Promise<UsageSummary> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const repo = createUsageRepository(db)
  const plans = await repo.listPlans(tenantId)
  const { termStart, termEnd, plan } = windowFor(plans, today, opts.year)
  const window = { from: termStart, to: termEnd }

  const [used, byMonthRaw, byAction, byWorkflowRaw] = await Promise.all([
    repo.countActions(tenantId, window),
    repo.countByMonth(tenantId, window),
    repo.countByAction(tenantId, window),
    repo.countByWorkflow(tenantId, window),
  ])

  const counted = new Map(byMonthRaw.map((m) => [m.month, m.actions]))
  const byMonth = monthsOf(termStart, termEnd).map((month) => ({
    month,
    actions: counted.get(month) ?? 0,
  }))

  const ids = byWorkflowRaw.flatMap((w) => (w.workflowId ? [w.workflowId] : []))
  const names = new Map(
    ids.length === 0
      ? []
      : (
          await db.workflow.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((w) => [w.id, w.name]),
  )
  const byWorkflow = byWorkflowRaw.map((w) => ({
    workflowId: w.workflowId,
    workflowName: w.workflowId ? (names.get(w.workflowId) ?? null) : null,
    actions: w.actions,
  }))

  const pool = plan?.annualPoolActions ?? null
  const inProgress = today >= termStart && today < termEnd
  return {
    plan: plan
      ? {
          planCode: plan.planCode,
          name: AUTOMATION_PLAN_CATALOG[plan.planCode]?.name ?? plan.planCode,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPoolActions: plan.annualPoolActions,
          overageCentsPerAction: plan.overageCentsPerAction,
          effectiveFrom: plan.effectiveFrom,
        }
      : null,
    termStart,
    termEnd,
    pool,
    usedTermToDate: used,
    remaining: pool === null ? null : Math.max(0, pool - used),
    overageActions: pool === null ? 0 : Math.max(0, used - pool),
    projectedAtTermEnd: inProgress
      ? projectTermUsage({ usedToDate: used, termStart, termEnd, asOf: today })
      : today < termStart
        ? 0
        : null,
    asOf: today,
    byMonth,
    byAction,
    byWorkflow,
  }
}
