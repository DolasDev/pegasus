// ---------------------------------------------------------------------------
// Monthly usage-statement close (plans/completed/usage-metering.md, Phase 4).
//
// For every tenant that has ever had an automation plan, write the statement
// for each fully-past month that has none — oldest first, from the tenant's
// first term. That makes the daily run idempotent (a closed month is skipped;
// the unique (tenant, periodMonth) key backs it up) and self-healing: a job
// that was down across a month boundary backfills on its next run, in order,
// so each month sees the overage its predecessors in the term already billed.
//
// What a month owes is decided by @pegasus/domain closeMonthlyStatement; this
// only counts UsageEvents and loads history. Uses the ROOT client: cross-tenant
// by design, every query names tenantId.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { addMonths, closeMonthlyStatement, statementWindow } from '@pegasus/domain'
import { createUsageRepository } from '../../repositories/usage.repository'

export interface CloseResult {
  tenantsChecked: number
  statementsWritten: Array<{ tenantId: string; periodMonth: string }>
  failures: Array<{ tenantId: string; error: string }>
}

/** Every `YYYY-MM` from `fromMonth` up to (not including) `toMonth`. */
function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = []
  for (let m = `${fromMonth}-01`; m.slice(0, 7) < toMonth; m = addMonths(m, 1)) {
    out.push(m.slice(0, 7))
  }
  return out
}

export async function closeTenantStatements(
  db: PrismaClient,
  tenantId: string,
  today: string,
): Promise<string[]> {
  const repo = createUsageRepository(db)
  const history = await repo.listPlans(tenantId)
  const first = history.map((p) => p.termStart).sort()[0]
  if (!first) return []

  const closed = new Set((await repo.listStatements(tenantId)).map((s) => s.periodMonth))
  const written: string[] = []

  for (const periodMonth of monthsBetween(first.slice(0, 7), today.slice(0, 7))) {
    if (closed.has(periodMonth)) continue
    const window = statementWindow(periodMonth, history)
    if (!window) continue // a gap between terms: nothing to bill

    const month = { from: window.monthStart, to: window.monthEnd }
    const [actionsInMonth, termToDateActions, overageActionsBilledThisTerm] = await Promise.all([
      repo.countActions(tenantId, month),
      repo.countActions(tenantId, { from: window.plan.termStart, to: window.monthEnd }),
      repo.overageBilledInTerm(tenantId, window.plan.termStart),
    ])
    const lines = closeMonthlyStatement({
      periodMonth,
      history,
      actionsInMonth,
      termToDateActions,
      overageActionsBilledThisTerm,
    })
    if (lines && (await repo.createStatement(tenantId, lines))) written.push(periodMonth)
  }
  return written
}

export async function closeUsageStatements(
  db: PrismaClient,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<CloseResult> {
  const tenantIds = await createUsageRepository(db).listTenantIdsWithPlans()
  const result: CloseResult = {
    tenantsChecked: tenantIds.length,
    statementsWritten: [],
    failures: [],
  }
  // Sequential: a handful of tenants, a few queries each — and one tenant's
  // failure must not stop the others.
  for (const tenantId of tenantIds) {
    try {
      for (const periodMonth of await closeTenantStatements(db, tenantId, today)) {
        result.statementsWritten.push({ tenantId, periodMonth })
      }
    } catch (err) {
      result.failures.push({ tenantId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
