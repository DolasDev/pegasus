import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Usage — billable automated actions against the tenant's automation plan.
// Mirrors `UsageSummary` in apps/api/src/lib/usage/usage-summary.ts.
// ---------------------------------------------------------------------------

export interface UsagePlan {
  planCode: string
  name: string
  monthlyPriceCents: number
  annualPoolActions: number
  overageCentsPerAction: number
  effectiveFrom: string
}

export interface UsageSummary {
  plan: UsagePlan | null
  /** Inclusive start of the window counted (YYYY-MM-DD). */
  termStart: string
  /** EXCLUSIVE end of the window counted (YYYY-MM-DD). */
  termEnd: string
  pool: number | null
  usedTermToDate: number
  remaining: number | null
  overageActions: number
  /** Linear projection of the term total — an estimate. Null once the window is over. */
  projectedAtTermEnd: number | null
  asOf: string
  byMonth: Array<{ month: string; actions: number }>
  byAction: Array<{ action: string; actions: number }>
  byWorkflow: Array<{ workflowId: string | null; workflowName: string | null; actions: number }>
}

export async function getUsageSummary(year?: number): Promise<UsageSummary> {
  const qs = year !== undefined ? `?year=${year}` : ''
  return apiFetch<UsageSummary>(`/api/v1/usage/summary${qs}`)
}
