// ---------------------------------------------------------------------------
// Usage statements — the monthly close a manual invoice is raised from, and
// the term projection shown on the Usage pages
// (plans/in-progress/usage-metering.md, Phase 4).
//
// Pure functions: the caller counts UsageEvents and loads plan history and
// prior statements; these decide what the month owes.
//
// - The plan price is billed monthly, pro-rated by day across the plans in
//   effect during the month (a mid-month upgrade pays the old price up to the
//   upgrade and the new price after).
// - Overage is billed only once the TERM-TO-DATE count passes the pool in
//   effect at month end (an upgrade's pool applies to the whole term), and
//   only the part no earlier statement in the term already billed.
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  daysBetween,
  planInEffect,
  type AutomationPlanCode,
  type AutomationPlanPeriod,
} from './automation-plans'

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isPeriodMonth(value: string): boolean {
  return PERIOD_MONTH_RE.test(value)
}

/** The `YYYY-MM` before `periodMonth`. */
export function previousPeriodMonth(periodMonth: string): string {
  return addMonths(`${periodMonth}-01`, -1).slice(0, 7)
}

export interface StatementWindow {
  /** First day of the month. */
  readonly monthStart: string
  /** First day of the next month (exclusive). */
  readonly monthEnd: string
  /** The plan in effect on the month's last day, which sets pool and overage rate. */
  readonly plan: AutomationPlanPeriod
}

/**
 * The window a month's statement covers, or null when no plan is in effect at
 * month end (nothing to bill). Terms start on a month's 1st, so a term never
 * ends mid-month.
 */
export function statementWindow(
  periodMonth: string,
  history: readonly AutomationPlanPeriod[],
): StatementWindow | null {
  if (!isPeriodMonth(periodMonth)) throw new RangeError('periodMonth must be YYYY-MM')
  const monthStart = `${periodMonth}-01`
  const monthEnd = addMonths(monthStart, 1)
  const plan = planInEffect(history, addDays(monthEnd, -1))
  return plan ? { monthStart, monthEnd, plan } : null
}

export interface StatementInput {
  readonly periodMonth: string
  readonly history: readonly AutomationPlanPeriod[]
  /** Billable actions with occurredAt in the month. */
  readonly actionsInMonth: number
  /** Billable actions from the term's start through the month's end. */
  readonly termToDateActions: number
  /** Sum of `overageActions` on this term's earlier statements. */
  readonly overageActionsBilledThisTerm: number
}

export interface UsageStatementLines {
  readonly periodMonth: string
  readonly planCode: AutomationPlanCode
  readonly termStart: string
  readonly termEnd: string
  /** The month-end plan's full monthly price (before pro-rating). */
  readonly monthlyPriceCents: number
  /** What the month owes for the plan, pro-rated by day across upgrades. */
  readonly proRatedPlanCents: number
  readonly actionsInMonth: number
  readonly termToDateActions: number
  readonly pool: number
  readonly overageActions: number
  readonly overageCentsPerAction: number
  readonly overageCents: number
  readonly totalCents: number
}

export function closeMonthlyStatement(input: StatementInput): UsageStatementLines | null {
  const window = statementWindow(input.periodMonth, input.history)
  if (!window) return null
  const { monthStart, monthEnd, plan } = window

  const daysInMonth = daysBetween(monthStart, monthEnd)
  let planCentsTimesDays = 0
  for (let day = monthStart; day < monthEnd; day = addDays(day, 1)) {
    planCentsTimesDays += planInEffect(input.history, day)?.monthlyPriceCents ?? 0
  }
  const proRatedPlanCents = Math.round(planCentsTimesDays / daysInMonth)

  const pool = plan.annualPoolActions
  const overTermToDate = Math.max(0, input.termToDateActions - pool)
  const overageActions = Math.max(0, overTermToDate - input.overageActionsBilledThisTerm)
  const overageCents = overageActions * plan.overageCentsPerAction

  return {
    periodMonth: input.periodMonth,
    planCode: plan.planCode,
    termStart: plan.termStart,
    termEnd: plan.termEnd,
    monthlyPriceCents: plan.monthlyPriceCents,
    proRatedPlanCents,
    actionsInMonth: input.actionsInMonth,
    termToDateActions: input.termToDateActions,
    pool,
    overageActions,
    overageCentsPerAction: plan.overageCentsPerAction,
    overageCents,
    totalCents: proRatedPlanCents + overageCents,
  }
}

/**
 * Linear projection of the term's total from its count so far. An ESTIMATE:
 * seasonal tenants (June–July ≈ 2.5× February) will see it swing.
 * `asOf` counts as an elapsed day.
 */
export function projectTermUsage(input: {
  readonly usedToDate: number
  readonly termStart: string
  readonly termEnd: string
  readonly asOf: string
}): number {
  const total = daysBetween(input.termStart, input.termEnd)
  const elapsed = Math.min(total, Math.max(1, daysBetween(input.termStart, input.asOf) + 1))
  return Math.round((input.usedToDate * total) / elapsed)
}
