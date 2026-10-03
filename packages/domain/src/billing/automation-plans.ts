// ---------------------------------------------------------------------------
// Automation plans — the published plan catalog and the rules for a tenant's
// plan history (plans/completed/usage-metering.md).
//
// A plan buys an ANNUAL pool of billable automated actions, billed monthly at
// 1/12 of the annual price. Beyond the pool, each action is billed at the
// overage rate. Moving up is allowed at any time (pro-rated by day, and the
// new pool applies to the whole term); moving down only at renewal. Each
// renewal escalates prices by 4%.
//
// Dates are ISO calendar dates ('YYYY-MM-DD'), compared as strings, so no
// timezone ever enters the arithmetic.
// ---------------------------------------------------------------------------

export const AUTOMATION_PLAN_CODES = ['STARTER', 'GROWTH', 'SCALE'] as const
export type AutomationPlanCode = (typeof AUTOMATION_PLAN_CODES)[number]

/** The priced terms of a plan. Stored per tenant row so an escalator is data, not a deploy. */
export interface AutomationPlanTerms {
  readonly monthlyPriceCents: number
  readonly annualPoolActions: number
  readonly overageCentsPerAction: number
}

export interface AutomationPlanCatalogEntry extends AutomationPlanTerms {
  readonly code: AutomationPlanCode
  /** Public plan name (D1). Keep in step with apps/company-web and the NW proposal. */
  readonly name: string
}

/** The published defaults (approved 2026-09-30). */
export const AUTOMATION_PLAN_CATALOG: Readonly<
  Record<AutomationPlanCode, AutomationPlanCatalogEntry>
> = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    monthlyPriceCents: 30_000,
    annualPoolActions: 6_000,
    overageCentsPerAction: 30,
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth',
    monthlyPriceCents: 65_000,
    annualPoolActions: 15_000,
    overageCentsPerAction: 30,
  },
  SCALE: {
    code: 'SCALE',
    name: 'Scale',
    monthlyPriceCents: 120_000,
    annualPoolActions: 50_000,
    overageCentsPerAction: 30,
  },
}

/** Applied to plan prices and the overage rate at each renewal. */
export const RENEWAL_ESCALATOR_RATE = 0.04

export function isAutomationPlanCode(value: string): value is AutomationPlanCode {
  return (AUTOMATION_PLAN_CODES as readonly string[]).includes(value)
}

/**
 * Prices after `renewals` 4% escalations, compounding, each rounded to whole
 * cents: a published price is a price in cents ($0.30 → $0.31, not $0.312).
 * The pool does not escalate.
 */
export function escalatePlanTerms(
  terms: AutomationPlanTerms,
  renewals: number,
): AutomationPlanTerms {
  if (!Number.isInteger(renewals) || renewals < 0) {
    throw new RangeError('renewals must be a non-negative integer')
  }
  let monthly = terms.monthlyPriceCents
  let overage = terms.overageCentsPerAction
  for (let i = 0; i < renewals; i++) {
    monthly = Math.round(monthly * (1 + RENEWAL_ESCALATOR_RATE))
    overage = Math.round(overage * (1 + RENEWAL_ESCALATOR_RATE))
  }
  return {
    monthlyPriceCents: monthly,
    annualPoolActions: terms.annualPoolActions,
    overageCentsPerAction: overage,
  }
}

// ---------------------------------------------------------------------------
// ISO calendar-date helpers
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMonths(date: string, months: number): string {
  const d = toUtc(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (exclusive of `to`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Plan history
// ---------------------------------------------------------------------------

/**
 * One row of a tenant's plan history. Rows are never updated: a change inserts
 * a new row.
 *
 * - `termStart`/`termEnd` bound the CONTRACT TERM (a year, starting on the 1st
 *   of a month). An upgrade keeps its term's bounds.
 * - `effectiveFrom` is when THIS row's prices and pool take effect: the term
 *   start for a new term or renewal, the upgrade date for a mid-term upgrade.
 */
export interface AutomationPlanPeriod extends AutomationPlanTerms {
  readonly planCode: AutomationPlanCode
  readonly termStart: string
  readonly termEnd: string
  readonly effectiveFrom: string
}

/** The row in effect on `date`, or null. The latest `effectiveFrom` wins. */
export function planInEffect<T extends AutomationPlanPeriod>(
  rows: readonly T[],
  date: string,
): T | null {
  let best: T | null = null
  for (const row of rows) {
    if (row.termStart > date || date >= row.termEnd || row.effectiveFrom > date) continue
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row
  }
  return best
}

/** A term is one year from a month's 1st. */
export function termEndFor(termStart: string): string {
  return addMonths(termStart, 12)
}

/**
 * Validates a proposed plan row against the tenant's history, or returns null.
 *
 * - The term starts on the 1st of a month and lasts exactly a year.
 * - `effectiveFrom` falls inside the term.
 * - A new term must not overlap an existing one.
 * - Within an existing term, a change is an UPGRADE only (a larger pool) and
 *   cannot be backdated before the row it replaces; down only at renewal.
 */
export function validatePlanChange(
  history: readonly AutomationPlanPeriod[],
  proposed: AutomationPlanPeriod,
): string | null {
  const { termStart, termEnd, effectiveFrom } = proposed
  if (!isIsoDate(termStart) || !isIsoDate(effectiveFrom)) return 'dates must be YYYY-MM-DD'
  if (!termStart.endsWith('-01')) return 'termStart must be the 1st of a month'
  if (termEnd !== termEndFor(termStart)) return 'a term lasts exactly one year'
  if (effectiveFrom < termStart || effectiveFrom >= termEnd) {
    return 'effectiveFrom must fall inside the term'
  }
  for (const t of [
    proposed.monthlyPriceCents,
    proposed.annualPoolActions,
    proposed.overageCentsPerAction,
  ]) {
    if (!Number.isInteger(t) || t < 0) return 'prices and pool must be non-negative integers'
  }

  const sameTerm = history.filter((r) => r.termStart === termStart)
  if (sameTerm.length === 0) {
    const overlaps = history.some((r) => r.termStart < termEnd && termStart < r.termEnd)
    if (overlaps) return 'the term overlaps an existing term'
    if (effectiveFrom !== termStart) return 'a new term takes effect on its first day'
    return null
  }

  const current = sameTerm.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a))
  if (effectiveFrom < current.effectiveFrom) {
    return `a mid-term change cannot take effect before ${current.effectiveFrom}`
  }
  if (proposed.annualPoolActions <= current.annualPoolActions) {
    return 'within a term a plan can only move up; move down at renewal'
  }
  return null
}
