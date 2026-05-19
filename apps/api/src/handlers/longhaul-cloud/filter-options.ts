// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /filter-options` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/filter-options from the cloud Hono Lambda
// instead of proxying it to the tenant's on-prem server. Mounted in app.ts
// ahead of the /onprem wildcard proxy so Hono route precedence routes
// /filter-options here while every un-migrated longhaul endpoint still falls
// through to the proxy.
//
// `/filter-options` returns the MoveType lookup options used to populate
// shipment-filter dropdowns. It runs one query through the in-VPC
// mssql-executor Lambda and matches the on-prem response shape exactly:
// `{ data: { moveType: [{ value, label }, ...] } }`.
//
// On-prem semantics (repositories/longhaul/filter-options.repository.ts →
// getFilterOptions): select move_type_desc + move_type from the MoveType
// table, filtered by the per-client `moveTypesWhere` SQL fragment, ordered by
// move_type_desc ASC, mapped to { value: move_type, label: move_type_desc }.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'
import { getLonghaulClientConfig } from '../../lib/longhaul-client-config'
import { logger } from '../../lib/logger'

/** Single-row shape of the MoveType query — mirrors the on-prem result. */
interface MoveTypeRow {
  move_type_desc: string
  move_type: string
}

export const longhaulFilterOptionsHandler: Handler<AppEnv> = async (c) => {
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
    // `moveTypesWhere` is a server-side per-client constant (not user input);
    // it is interpolated into the WHERE clause exactly as the on-prem Knex
    // `.whereRaw(moveTypesWhere)` does.
    const { moveTypesWhere } = getLonghaulClientConfig()
    const sql =
      'SELECT move_type_desc, move_type FROM MoveType ' +
      `WHERE ${moveTypesWhere} ` +
      'ORDER BY move_type_desc ASC'

    const { recordset } = await executeSql(tenant.mssqlConnectionString, sql)
    const rows = recordset as MoveTypeRow[]
    const data = {
      moveType: rows.map(({ move_type_desc, move_type }) => ({
        value: move_type,
        label: move_type_desc,
      })),
    }
    return c.json({ data })
  } catch (err) {
    logger.error('longhaul cloud filter-options failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch filter options',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
