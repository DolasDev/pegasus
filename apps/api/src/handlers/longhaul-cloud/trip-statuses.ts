// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /trip-statuses` handler.
//
// Phase 3 strangler-fig migration gap: the tenant Driver Planning UI fetches
// /api/v1/onprem/longhaul/trip-statuses on bootstrap (AppGuard reference data),
// but this endpoint was never ported to a cloud-direct handler and the /onprem
// wildcard proxy that used to serve it was removed in Phase 5 — so the request
// fell through to app.notFound() → 404. This restores it cloud-direct, matching
// the other reference-data handlers (states/zones).
//
// The on-prem route (`tripsRouter.get('/trip-statuses')`) returned every row of
// the `MasterTripStatus` table verbatim via `SELECT * FROM MasterTripStatus`,
// in `{ data: [...] }` shape. `MasterTripStatus` already exposes lowercase
// `status_id` / `status` columns (see trip-detail / trips-list JOINs), which is
// exactly what the ported StatusDropdown reads (`status.status_id`,
// `status.status`) — so no key-casing transform is needed here.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { logger } from '../../lib/logger'

const TRIP_STATUSES_SQL = 'SELECT * FROM MasterTripStatus'

export const longhaulTripStatusesHandler: Handler<AppEnv> = async (c) => {
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
    const { recordset } = await executeSql(tenant.mssqlConnectionString, TRIP_STATUSES_SQL)
    return c.json({ data: recordset })
  } catch (err) {
    logger.error('longhaul cloud trip-statuses failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch trip statuses',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
