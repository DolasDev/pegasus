// ---------------------------------------------------------------------------
// Cloud-direct longhaul shipment WRITE handlers (Phase 4 #2-#4).
//
// On-prem source: handlers/longhaul/shipments.ts + shipments.repository.ts.
//   #2 PATCH /shipments/:id/shadow   → patchShipmentShadow (upsert into `sales`)
//   #4 POST  /shipments/:id/coverage → saveCoverage  (upsert longhaul_shipmentcoverage, returns row)
//
// NOTE: the inventory's #3 PATCH /shipments/:id/weight is intentionally NOT
// migrated — it is a dead route. No tenant-web caller invokes it, and the
// on-prem patchWeight writes a scalar `weight`/`updated_at` to
// longhaul_shipment_weight_link, which has neither column (it is a link table
// of weight-record ids: survey_weight_id, initial_weight_id, …). It 500s
// against the real schema on both paths. It stays on the /onprem proxy
// untouched until the feature is redesigned.
//
// Both handlers mirror knex's "only write provided keys" semantics via pickColumns
// (lib/longhaul-cloud-write) — authoring a fixed column list would null fields
// the client omitted. The shadow upsert E2E (longhaul-qa.spec.ts:468) sends
// only `lng_dis_comments` and asserts the rest survive, so this matters.
//
// The shipment routes do NOT read the legacy user for audit columns on-prem
// (coverage carries created_by_id/updated_by_id in its body); resolveLonghaulUser
// is still called to enforce the same 401/403/422 auth parity as the proxy.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError, type SqlParam } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { pickColumns, assignments, valuePlaceholders } from '../../lib/longhaul-cloud-write'
import { logger } from '../../lib/logger'

// --- #2 shadow ------------------------------------------------------------

const ShadowBody = z.object({
  order_num: z.number(),
  operations_id: z.string().nullable().optional(),
  operations_name: z.string().nullable().optional(),
  lng_dis_comments: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
})

const SHADOW_COLUMNS = ['operations_id', 'operations_name', 'lng_dis_comments', 'weight'] as const

export const longhaulShipmentShadowHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const parsed = ShadowBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const orderNum = parsed.data.order_num

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  // Upsert into `sales` keyed by order_num, writing only the provided shadow
  // columns (knex .update({...rest}) parity — omitted columns are preserved).
  const { columns, params } = pickColumns(parsed.data as Record<string, unknown>, SHADOW_COLUMNS)

  let sql: string
  if (columns.length === 0) {
    // No shadow fields to write — ensure the row exists (on-prem inserts a bare
    // {order_num} when absent; a no-op when present).
    sql = `IF NOT EXISTS (SELECT 1 FROM sales WHERE order_num = @order_num) INSERT INTO sales (order_num) VALUES (@order_num);`
  } else {
    sql = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF EXISTS (SELECT 1 FROM sales WHERE order_num = @order_num)
  UPDATE sales SET ${assignments([...columns])} WHERE order_num = @order_num;
ELSE
  INSERT INTO sales (order_num, ${columns.join(', ')})
  VALUES (@order_num, ${valuePlaceholders([...columns])});`
  }

  try {
    await executeSql(resolved.connectionString, sql, {
      params: [...params, { name: 'order_num', value: orderNum }],
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud shadow PATCH failed', { error: errDetail(err) })
    return c.json(
      { error: 'Failed to patch shipment shadow', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

// --- #4 coverage ----------------------------------------------------------

const CoverageBody = z.object({
  order_num: z.number(),
  activity_code: z.string().min(1),
  coverage_agent_id: z.string().min(1),
  note: z.string().nullable().optional(),
  is_covered: z.boolean().nullable().optional(),
  created_by_id: z.number().optional(),
  updated_by_id: z.number().nullable().optional(),
})

const COVERAGE_NONKEY = ['note', 'is_covered', 'created_by_id', 'updated_by_id'] as const

export const longhaulShipmentCoverageHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const parsed = CoverageBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  const { columns, params } = pickColumns(parsed.data as Record<string, unknown>, COVERAGE_NONKEY)
  const keyParams: SqlParam[] = [
    { name: 'order_num', value: parsed.data.order_num },
    { name: 'activity_code', value: parsed.data.activity_code },
    { name: 'coverage_agent_id', value: parsed.data.coverage_agent_id },
  ]
  const keyWhere =
    'order_num = @order_num AND activity_code = @activity_code AND coverage_agent_id = @coverage_agent_id'

  // Atomic upsert (multi-table-safe pattern from Unit 0): IF EXISTS UPDATE /
  // ELSE INSERT, then COMMIT, then a trailing SELECT returns the saved row.
  const updateSet = [assignments([...columns]), 'updated_date = GETDATE()']
    .filter(Boolean)
    .join(', ')
  const insertCols = ['order_num', 'activity_code', 'coverage_agent_id', ...columns, 'created_date']
  const insertVals = [
    '@order_num',
    '@activity_code',
    '@coverage_agent_id',
    ...columns.map((col) => `@${col}`),
    'GETDATE()',
  ]
  const sql = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF EXISTS (SELECT 1 FROM longhaul_shipmentcoverage WHERE ${keyWhere})
    UPDATE longhaul_shipmentcoverage SET ${updateSet} WHERE ${keyWhere};
  ELSE
    INSERT INTO longhaul_shipmentcoverage (${insertCols.join(', ')})
    VALUES (${insertVals.join(', ')});
  COMMIT TRAN;
  SELECT * FROM longhaul_shipmentcoverage WHERE ${keyWhere};
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;`

  try {
    const { recordset } = await executeSql(resolved.connectionString, sql, {
      params: [...keyParams, ...params],
    })
    const row = recordset[0] as Record<string, unknown> | undefined
    return c.json({ data: row ?? null }, 201)
  } catch (err) {
    logger.error('longhaul cloud coverage POST failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to save coverage', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

function errDetail(err: unknown): string {
  return err instanceof MssqlExecError ? err.message : String(err)
}
