import { ApiError } from '@pegasus/api-http'
import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'
import { adminFetch } from './client'

// ---------------------------------------------------------------------------
// Types — re-declared rather than imported to keep the workspace boundary
// clean (admin-web does not import from apps/api). Shapes mirror
// apps/api/src/handlers/admin/tenant-usage.ts and lib/usage/usage-summary.ts.
// ---------------------------------------------------------------------------

export type AutomationPlanCode = 'STARTER' | 'GROWTH' | 'SCALE'

export interface UsageSummary {
  plan: {
    planCode: string
    name: string
    monthlyPriceCents: number
    annualPoolActions: number
    overageCentsPerAction: number
    effectiveFrom: string
  } | null
  termStart: string
  /** Exclusive. */
  termEnd: string
  pool: number | null
  usedTermToDate: number
  remaining: number | null
  overageActions: number
  /** Linear projection — an estimate. Null once the window is over. */
  projectedAtTermEnd: number | null
  asOf: string
  byMonth: Array<{ month: string; actions: number }>
  byAction: Array<{ action: string; actions: number }>
  byWorkflow: Array<{ workflowId: string | null; workflowName: string | null; actions: number }>
}

export interface AutomationPlanRow {
  id: string
  planCode: AutomationPlanCode
  monthlyPriceCents: number
  annualPoolActions: number
  overageCentsPerAction: number
  termStart: string
  /** Exclusive. */
  termEnd: string
  effectiveFrom: string
  createdAt: string
  createdBy: string
}

export interface CatalogEntry {
  code: AutomationPlanCode
  name: string
  monthlyPriceCents: number
  annualPoolActions: number
  overageCentsPerAction: number
}

export interface AutomationPlanState {
  current: AutomationPlanRow | null
  history: AutomationPlanRow[]
  catalog: CatalogEntry[]
}

export interface AssignPlanInput {
  planCode: AutomationPlanCode
  termStart: string
  effectiveFrom?: string
  monthlyPriceCents?: number
  annualPoolActions?: number
  overageCentsPerAction?: number
}

export interface UsageStatement {
  id: string
  periodMonth: string
  planCode: AutomationPlanCode
  termStart: string
  termEnd: string
  monthlyPriceCents: number
  proRatedPlanCents: number
  actionsInMonth: number
  termToDateActions: number
  pool: number
  overageActions: number
  overageCentsPerAction: number
  overageCents: number
  totalCents: number
  closedAt: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function getTenantUsage(tenantId: string, year?: number): Promise<UsageSummary> {
  const qs = year !== undefined ? `?year=${year}` : ''
  return adminFetch<UsageSummary>(`/api/admin/tenants/${tenantId}/usage${qs}`)
}

export async function getAutomationPlan(tenantId: string): Promise<AutomationPlanState> {
  return adminFetch<AutomationPlanState>(`/api/admin/tenants/${tenantId}/automation-plan`)
}

export async function assignAutomationPlan(
  tenantId: string,
  input: AssignPlanInput,
): Promise<AutomationPlanRow> {
  return adminFetch<AutomationPlanRow>(`/api/admin/tenants/${tenantId}/automation-plan`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listUsageStatements(tenantId: string): Promise<UsageStatement[]> {
  return adminFetch<UsageStatement[]>(`/api/admin/tenants/${tenantId}/usage/statements`)
}

export function statementCsvPath(tenantId: string, periodMonth: string): string {
  return `/api/admin/tenants/${tenantId}/usage/statements/${periodMonth}?format=csv`
}

/**
 * Download one closed month as CSV. Raw fetch because the response is
 * text/csv, not a `{ data }` envelope the shared adminFetch unwraps.
 */
export async function exportStatementCsv(tenantId: string, periodMonth: string): Promise<void> {
  const res = await fetch(`${getConfig().apiUrl}${statementCsvPath(tenantId, periodMonth)}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (!res.ok) {
    let message = `Export failed (${res.status})`
    let code = 'EXPORT_FAILED'
    try {
      const json = (await res.json()) as { error?: string; code?: string }
      message = json.error ?? message
      code = json.code ?? code
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, code, res.status)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `usage-statement-${tenantId}-${periodMonth}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Prices after `renewals` 4% escalations, compounding, each rounded to whole
 * cents — the same rule as @pegasus/domain escalatePlanTerms. Pool unchanged.
 */
export function escalate(
  terms: { monthlyPriceCents: number; overageCentsPerAction: number },
  renewals: number,
): { monthlyPriceCents: number; overageCentsPerAction: number } {
  let monthly = terms.monthlyPriceCents
  let overage = terms.overageCentsPerAction
  for (let i = 0; i < renewals; i++) {
    monthly = Math.round(monthly * 1.04)
    overage = Math.round(overage * 1.04)
  }
  return { monthlyPriceCents: monthly, overageCentsPerAction: overage }
}
