import { describe, it, expect } from 'vitest'
import {
  AUTOMATION_PLAN_CATALOG,
  addDays,
  addMonths,
  daysBetween,
  escalatePlanTerms,
  isAutomationPlanCode,
  isIsoDate,
  planInEffect,
  termEndFor,
  validatePlanChange,
  type AutomationPlanCode,
  type AutomationPlanPeriod,
} from '../automation-plans'

function row(
  planCode: AutomationPlanCode,
  termStart: string,
  effectiveFrom = termStart,
): AutomationPlanPeriod {
  const { monthlyPriceCents, annualPoolActions, overageCentsPerAction } =
    AUTOMATION_PLAN_CATALOG[planCode]
  return {
    planCode,
    monthlyPriceCents,
    annualPoolActions,
    overageCentsPerAction,
    termStart,
    termEnd: termEndFor(termStart),
    effectiveFrom,
  }
}

describe('AUTOMATION_PLAN_CATALOG', () => {
  it('publishes the approved plans (D1/D2): Starter, Growth, Scale and nothing above', () => {
    expect(Object.values(AUTOMATION_PLAN_CATALOG)).toEqual([
      expect.objectContaining({
        name: 'Starter',
        monthlyPriceCents: 30_000,
        annualPoolActions: 6_000,
      }),
      expect.objectContaining({
        name: 'Growth',
        monthlyPriceCents: 65_000,
        annualPoolActions: 15_000,
      }),
      expect.objectContaining({
        name: 'Scale',
        monthlyPriceCents: 120_000,
        annualPoolActions: 50_000,
      }),
    ])
    for (const plan of Object.values(AUTOMATION_PLAN_CATALOG)) {
      expect(plan.overageCentsPerAction).toBe(30)
    }
  })

  it('recognizes plan codes', () => {
    expect(isAutomationPlanCode('SCALE')).toBe(true)
    expect(isAutomationPlanCode('Scale')).toBe(false)
    expect(isAutomationPlanCode('ENTERPRISE')).toBe(false)
  })
})

describe('escalatePlanTerms', () => {
  it('raises prices 4% per renewal, compounding, in whole cents; the pool is unchanged', () => {
    const scale = AUTOMATION_PLAN_CATALOG.SCALE
    expect(escalatePlanTerms(scale, 0)).toEqual({
      monthlyPriceCents: 120_000,
      annualPoolActions: 50_000,
      overageCentsPerAction: 30,
    })
    expect(escalatePlanTerms(scale, 1)).toEqual({
      monthlyPriceCents: 124_800,
      annualPoolActions: 50_000,
      overageCentsPerAction: 31,
    })
    expect(escalatePlanTerms(scale, 2).monthlyPriceCents).toBe(129_792)
  })

  it('rejects a negative or fractional renewal count', () => {
    expect(() => escalatePlanTerms(AUTOMATION_PLAN_CATALOG.STARTER, -1)).toThrow(RangeError)
    expect(() => escalatePlanTerms(AUTOMATION_PLAN_CATALOG.STARTER, 1.5)).toThrow(RangeError)
  })
})

describe('date helpers', () => {
  it('validates ISO calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-2-1')).toBe(false)
  })
  it('adds days and months, and counts days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths('2026-10-01', 12)).toBe('2027-10-01')
    expect(daysBetween('2026-10-01', '2027-10-01')).toBe(365)
  })
})

describe('planInEffect', () => {
  const history = [row('STARTER', '2026-10-01'), row('GROWTH', '2026-10-01', '2027-03-15')]

  it('is null before the first term and after the last', () => {
    expect(planInEffect(history, '2026-09-30')).toBeNull()
    expect(planInEffect(history, '2027-10-01')).toBeNull()
  })

  it('picks the latest effective row on the date', () => {
    expect(planInEffect(history, '2027-03-14')?.planCode).toBe('STARTER')
    expect(planInEffect(history, '2027-03-15')?.planCode).toBe('GROWTH')
    expect(planInEffect(history, '2027-09-30')?.planCode).toBe('GROWTH')
  })
})

describe('validatePlanChange', () => {
  it('accepts a first term starting on the 1st', () => {
    expect(validatePlanChange([], row('STARTER', '2026-10-01'))).toBeNull()
  })

  it('rejects a term that does not start on the 1st or is not a year', () => {
    expect(validatePlanChange([], row('STARTER', '2026-10-15'))).toMatch(/1st of a month/)
    expect(
      validatePlanChange([], { ...row('STARTER', '2026-10-01'), termEnd: '2027-04-01' }),
    ).toMatch(/one year/)
  })

  it('rejects a new term that takes effect after its first day', () => {
    expect(validatePlanChange([], row('STARTER', '2026-10-01', '2026-10-05'))).toMatch(/first day/)
  })

  it('rejects an overlapping term', () => {
    expect(validatePlanChange([row('STARTER', '2026-10-01')], row('GROWTH', '2027-01-01'))).toMatch(
      /overlaps/,
    )
  })

  it('accepts a renewal at the old term end, onto any plan (down at renewal)', () => {
    const history = [row('SCALE', '2026-10-01')]
    expect(validatePlanChange(history, row('STARTER', '2027-10-01'))).toBeNull()
  })

  it('accepts a mid-term upgrade and refuses a mid-term downgrade or sideways move', () => {
    const history = [row('GROWTH', '2026-10-01')]
    expect(validatePlanChange(history, row('SCALE', '2026-10-01', '2027-02-10'))).toBeNull()
    expect(validatePlanChange(history, row('STARTER', '2026-10-01', '2027-02-10'))).toMatch(
      /only move up/,
    )
    expect(validatePlanChange(history, row('GROWTH', '2026-10-01', '2027-02-10'))).toMatch(
      /only move up/,
    )
  })

  it('refuses to backdate an upgrade before the row it replaces', () => {
    const history = [row('STARTER', '2026-10-01'), row('GROWTH', '2026-10-01', '2027-01-01')]
    expect(validatePlanChange(history, row('SCALE', '2026-10-01', '2026-12-01'))).toMatch(
      /cannot take effect before 2027-01-01/,
    )
  })

  it('rejects an effectiveFrom outside the term and negative prices', () => {
    expect(validatePlanChange([], row('STARTER', '2026-10-01', '2027-10-01'))).toMatch(
      /inside the term/,
    )
    expect(
      validatePlanChange([], { ...row('STARTER', '2026-10-01'), monthlyPriceCents: -1 }),
    ).toMatch(/non-negative/)
  })
})
