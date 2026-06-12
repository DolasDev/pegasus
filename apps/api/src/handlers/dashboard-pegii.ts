// ---------------------------------------------------------------------------
// Cloud-direct PegII dashboard handler.
//
// Serves GET /api/v1/dashboard/pegii from the cloud Hono Lambda by querying
// three on-prem MSSQL views in the tenant's legacy (PegII) database via the
// in-VPC mssql-executor Lambda. Same pattern as the longhaul-cloud reference
// handlers (see handlers/longhaul-cloud/zones.ts):
//   - look up the tenant's mssqlConnectionString (422 if not configured);
//   - run the three views in ONE batched multi-statement call → one round trip;
//   - return the `{ data }` envelope every tenant endpoint uses.
//
// Views (defined in the tenant's MSSQL):
//   v_dashboard1 — new orders YTD, grouped by move type + description;
//   v_dashboard2 — in-transit (loaded, not delivered), same grouping;
//   v_dashboard3 — scalar TotalInvoicesYTD (sum of invoicemaster YTD).
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../types'
import { db } from '../db'
import { executeSql } from '../lib/mssql-executor-client'
import { logger } from '../lib/logger'

// One batch, three SELECTs → result.recordsets[0..2]. The view columns are
// selected explicitly so the response shape is stable regardless of any extra
// columns a tenant may add to the underlying views.
const DASHBOARD_SQL =
  'SELECT move_count, movetype, move_desc FROM v_dashboard1;' +
  'SELECT move_count, movetype, move_desc FROM v_dashboard2;' +
  'SELECT TotalInvoicesYTD FROM v_dashboard3;'

interface MoveBreakdownRow {
  move_count: number
  movetype: string
  move_desc: string
}

function toBreakdown(rows: unknown[]): MoveBreakdownRow[] {
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    move_count: Number(r['move_count'] ?? 0),
    movetype: String(r['movetype'] ?? ''),
    move_desc: String(r['move_desc'] ?? ''),
  }))
}

export const dashboardPegiiHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId: c.get('correlationId'),
      },
      422,
    )
  }

  try {
    const { recordsets } = await executeSql(tenant.mssqlConnectionString, DASHBOARD_SQL)
    const newOrders = toBreakdown(recordsets[0] ?? [])
    const inTransit = toBreakdown(recordsets[1] ?? [])
    const invoiceRow = (recordsets[2]?.[0] ?? {}) as Record<string, unknown>
    const totalInvoicesYtd = Number(invoiceRow['TotalInvoicesYTD'] ?? 0)

    return c.json({ data: { newOrders, inTransit, totalInvoicesYtd } })
  } catch (err) {
    logger.error('dashboard pegii query failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch dashboard data',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
