import { describe, it, expect } from 'vitest'
import {
  AUTOMATION_PLAN_CATALOG,
  escalatePlanTerms,
  termEndFor,
  type AutomationPlanCode,
  type AutomationPlanPeriod,
} from '../automation-plans'
import {
  closeMonthlyStatement,
  isPeriodMonth,
  previousPeriodMonth,
  projectTermUsage,
  statementWindow,
  type UsageStatementLines,
} from '../usage-statement'

function row(
  planCode: AutomationPlanCode,
  termStart: string,
  effectiveFrom = termStart,
  terms = AUTOMATION_PLAN_CATALOG[planCode],
): AutomationPlanPeriod {
  return {
    planCode,
    monthlyPriceCents: terms.monthlyPriceCents,
    annualPoolActions: terms.annualPoolActions,
    overageCentsPerAction: terms.overageCentsPerAction,
    termStart,
    termEnd: termEndFor(termStart),
    effectiveFrom,
  }
}

/**
 * Close every month of a term in order, carrying the term-to-date count and
 * the overage already billed exactly as the close job does.
 */
function closeTerm(
  history: readonly AutomationPlanPeriod[],
  months: readonly string[],
  actionsByMonth: readonly number[],
): UsageStatementLines[] {
  const statements: UsageStatementLines[] = []
  let termToDate = 0
  let billed = 0
  months.forEach((periodMonth, i) => {
    const actionsInMonth = actionsByMonth[i] ?? 0
    termToDate += actionsInMonth
    const s = closeMonthlyStatement({
      periodMonth,
      history,
      actionsInMonth,
      termToDateActions: termToDate,
      overageActionsBilledThisTerm: billed,
    })
    if (!s) throw new Error(`no statement for ${periodMonth}`)
    billed += s.overageActions
    statements.push(s)
  })
  return statements
}

const TERM_MONTHS = [
  '2025-09',
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
]

describe('period months', () => {
  it('validates YYYY-MM and steps back across a year', () => {
    expect(isPeriodMonth('2026-12')).toBe(true)
    expect(isPeriodMonth('2026-13')).toBe(false)
    expect(previousPeriodMonth('2027-01')).toBe('2026-12')
  })
})

describe('statementWindow', () => {
  it('is null for a month with no plan at month end', () => {
    expect(statementWindow('2026-09', [row('STARTER', '2026-10-01')])).toBeNull()
  })
  it('spans the calendar month', () => {
    expect(statementWindow('2026-10', [row('STARTER', '2026-10-01')])).toMatchObject({
      monthStart: '2026-10-01',
      monthEnd: '2026-11-01',
    })
  })
  it('rejects a malformed month', () => {
    expect(() => statementWindow('2026-1', [])).toThrow(RangeError)
  })
})

describe('closeMonthlyStatement', () => {
  it("a seasonal year (NW's 24-month curve × 9.1 actions/move) stays inside the Scale pool", () => {
    // NW household moves, Sep 2025 – Aug 2026 (terms-recommendation.md §3).
    // June alone is 5,697 actions — over a monthly twelfth of the pool (4,167)
    // — which is exactly why the pool is annual.
    const moves = [393, 405, 262, 347, 316, 260, 366, 343, 461, 626, 644, 481]
    const actions = moves.map((m) => Math.round(m * 9.1))
    const statements = closeTerm([row('SCALE', '2025-09-01')], TERM_MONTHS, actions)

    expect(statements.at(-1)?.termToDateActions).toBe(actions.reduce((a, b) => a + b, 0))
    expect(statements.at(-1)?.termToDateActions).toBeLessThan(50_000)
    for (const s of statements) {
      expect(s.overageActions).toBe(0)
      expect(s.proRatedPlanCents).toBe(120_000)
      expect(s.totalCents).toBe(120_000)
    }
  })

  it('bills overage only once the term-to-date count passes the pool, and never twice', () => {
    // Starter: 6,000 pool. 1,000/month crosses it in month 7.
    const statements = closeTerm(
      [row('STARTER', '2025-09-01')],
      TERM_MONTHS,
      TERM_MONTHS.map(() => 1_000),
    )
    expect(statements.slice(0, 6).every((s) => s.overageActions === 0)).toBe(true)
    expect(statements[6]).toMatchObject({
      termToDateActions: 7_000,
      overageActions: 1_000,
      overageCents: 30_000,
    })
    expect(statements[11]).toMatchObject({ termToDateActions: 12_000, overageActions: 1_000 })
    const totalOverage = statements.reduce((sum, s) => sum + s.overageActions, 0)
    expect(totalOverage).toBe(12_000 - 6_000)
  })

  it('an overage month bills only the part beyond the pool', () => {
    const s = closeMonthlyStatement({
      periodMonth: '2026-03',
      history: [row('STARTER', '2025-09-01')],
      actionsInMonth: 900,
      termToDateActions: 6_400,
      overageActionsBilledThisTerm: 0,
    })
    expect(s).toMatchObject({
      overageActions: 400,
      overageCents: 12_000,
      totalCents: 30_000 + 12_000,
    })
  })

  it('a mid-month upgrade pro-rates the plan by day and applies the new pool to the whole term', () => {
    // Starter → Growth on 2026-04-16: 15 days at $300, 15 at $650 (April has 30).
    const history = [row('STARTER', '2025-09-01'), row('GROWTH', '2025-09-01', '2026-04-16')]
    const s = closeMonthlyStatement({
      periodMonth: '2026-04',
      history,
      actionsInMonth: 1_200,
      termToDateActions: 9_000, // over Starter's 6,000 but inside Growth's 15,000
      overageActionsBilledThisTerm: 0,
    })
    expect(s).toMatchObject({
      planCode: 'GROWTH',
      pool: 15_000,
      overageActions: 0,
      monthlyPriceCents: 65_000,
      proRatedPlanCents: Math.round((15 * 30_000 + 15 * 65_000) / 30),
    })
  })

  it('an upgrade after overage was billed does not refund it, and bills only new overage', () => {
    const history = [row('STARTER', '2025-09-01'), row('GROWTH', '2025-09-01', '2026-05-01')]
    const s = closeMonthlyStatement({
      periodMonth: '2026-05',
      history,
      actionsInMonth: 2_000,
      termToDateActions: 10_000,
      overageActionsBilledThisTerm: 1_500, // billed under Starter in earlier months
    })
    expect(s).toMatchObject({ pool: 15_000, overageActions: 0, proRatedPlanCents: 65_000 })
  })

  it('the escalator applies at renewal: the new term bills the escalated row', () => {
    const renewed = escalatePlanTerms(AUTOMATION_PLAN_CATALOG.SCALE, 1)
    const history = [
      row('SCALE', '2025-09-01'),
      row('SCALE', '2026-09-01', '2026-09-01', { ...AUTOMATION_PLAN_CATALOG.SCALE, ...renewed }),
    ]
    const lastOfOld = closeMonthlyStatement({
      periodMonth: '2026-08',
      history,
      actionsInMonth: 51_000,
      termToDateActions: 51_000,
      overageActionsBilledThisTerm: 0,
    })
    const firstOfNew = closeMonthlyStatement({
      periodMonth: '2026-09',
      history,
      actionsInMonth: 51_000,
      termToDateActions: 51_000, // the term-to-date count restarts with the term
      overageActionsBilledThisTerm: 0,
    })
    expect(lastOfOld).toMatchObject({ termStart: '2025-09-01', totalCents: 120_000 + 1_000 * 30 })
    expect(firstOfNew).toMatchObject({
      termStart: '2026-09-01',
      monthlyPriceCents: 124_800,
      overageCentsPerAction: 31,
      totalCents: 124_800 + 1_000 * 31,
    })
  })

  it('is null for a month with no plan', () => {
    expect(
      closeMonthlyStatement({
        periodMonth: '2026-08',
        history: [row('STARTER', '2026-09-01')],
        actionsInMonth: 5,
        termToDateActions: 5,
        overageActionsBilledThisTerm: 0,
      }),
    ).toBeNull()
  })

  it('days of the month with no plan in effect cost nothing', () => {
    // Not reachable through validatePlanChange (a new term takes effect on its
    // 1st), but the function must not invent a price for an uncovered day.
    const s = closeMonthlyStatement({
      periodMonth: '2026-04',
      history: [row('STARTER', '2026-04-01', '2026-04-16')],
      actionsInMonth: 0,
      termToDateActions: 0,
      overageActionsBilledThisTerm: 0,
    })
    expect(s?.proRatedPlanCents).toBe(Math.round((15 * 30_000) / 30))
  })
})

describe('projectTermUsage', () => {
  it('projects linearly over the term', () => {
    // 2026-10-01..2027-10-01 is 365 days; 73 days elapsed including asOf.
    expect(
      projectTermUsage({
        usedToDate: 1_000,
        termStart: '2026-10-01',
        termEnd: '2027-10-01',
        asOf: '2026-12-12',
      }),
    ).toBe(5_000)
  })
  it('clamps before the term and after it', () => {
    const term = { termStart: '2026-10-01', termEnd: '2027-10-01' }
    expect(projectTermUsage({ ...term, usedToDate: 10, asOf: '2026-09-01' })).toBe(3_650)
    expect(projectTermUsage({ ...term, usedToDate: 40_000, asOf: '2028-01-01' })).toBe(40_000)
  })
})
