// ---------------------------------------------------------------------------
// Cloud-direct longhaul saved-shipment-filter CRUD (Phase 4 #10).
//
// On-prem source: handlers/longhaul/filter-options.ts + filter-options.repository.ts.
//   POST   /shipment-filters         → saveFilter (+ setDefaultFilter if is_default)
//   PUT    /shipment-filters/default → setDefaultFilter (upsert user prefs)
//   DELETE /shipment-filters/:id     → deleteFilter
//
// User-preference writes, low risk. longhaul_shipment_filter has no triggers,
// so OUTPUT INSERTED.* is safe to return the saved row in one statement.
//
// Auth/identity parity with the proxy:
//   - POST uses the BODY's user_code for owner_code (the proxy does too — it
//     does NOT read longhaulUser here); resolveLonghaulUser still runs for the
//     connection string + the same auth gate.
//   - PUT requires a resolved legacy user (the proxy 403s when longhaulUser is
//     absent) and writes prefs keyed by that user's code.
//   - DELETE needs neither code; resolveLonghaulUser provides the conn string.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { transformDatesToTimeDiff } from '../../lib/longhaul-filter-query-transform'
import { logger } from '../../lib/logger'

// Single-table upsert of the user's default filter (shared by POST is_default
// and PUT /default).
const SET_DEFAULT_SQL = `
SET XACT_ABORT ON;
IF EXISTS (SELECT 1 FROM longhaul_user_preferences WHERE user_id = @user_id)
  UPDATE longhaul_user_preferences SET default_filter_id = @filter_id WHERE user_id = @user_id;
ELSE
  INSERT INTO longhaul_user_preferences (user_id, default_filter_id) VALUES (@user_id, @filter_id);
`

// --- POST /shipment-filters -----------------------------------------------

const SaveFilterBody = z.object({
  name: z.string().min(1),
  user_code: z.string().or(z.number()),
  query: z.record(z.string(), z.unknown()),
  is_public: z.boolean().optional(),
  is_default: z.boolean().optional(),
})

const INSERT_FILTER_SQL = `
INSERT INTO longhaul_shipment_filter (name, owner_code, query, is_public)
OUTPUT INSERTED.*
VALUES (@name, @owner_code, @query, @is_public)
`

export const longhaulSaveShipmentFilterHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const parsed = SaveFilterBody.safeParse(await c.req.json().catch(() => null))
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
  const { connectionString } = resolved

  try {
    const transformedQuery = transformDatesToTimeDiff(parsed.data.query)
    const { recordset } = await executeSql(connectionString, INSERT_FILTER_SQL, {
      params: [
        { name: 'name', value: parsed.data.name.trim() },
        { name: 'owner_code', value: parsed.data.user_code },
        { name: 'query', value: JSON.stringify(transformedQuery) },
        { name: 'is_public', value: parsed.data.is_public ?? false },
      ],
    })
    const filter = recordset[0] as Record<string, unknown> | undefined

    if (parsed.data.is_default && filter?.['filter_id'] != null) {
      await executeSql(connectionString, SET_DEFAULT_SQL, {
        params: [
          { name: 'user_id', value: parsed.data.user_code },
          { name: 'filter_id', value: filter['filter_id'] },
        ],
      })
    }

    return c.json({ data: filter ?? null }, 201)
  } catch (err) {
    logger.error('longhaul cloud save shipment filter failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to save filter', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

// --- PUT /shipment-filters/default ----------------------------------------

const SetDefaultFilterBody = z.object({ filter_id: z.number() })

export const longhaulSetDefaultShipmentFilterHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const parsed = SetDefaultFilterBody.safeParse(await c.req.json().catch(() => null))
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
  // The proxy 403s when no longhaulUser is resolved (it keys prefs by user.code).
  if (resolved.code == null) {
    return c.json({ error: 'User not found', code: 'LONGHAUL_USER_NOT_FOUND', correlationId }, 403)
  }

  try {
    await executeSql(resolved.connectionString, SET_DEFAULT_SQL, {
      params: [
        { name: 'user_id', value: resolved.code },
        { name: 'filter_id', value: parsed.data.filter_id },
      ],
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud set default shipment filter failed', { error: errDetail(err) })
    return c.json(
      { error: 'Failed to set default filter', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

// --- DELETE /shipment-filters/:id -----------------------------------------

export const longhaulDeleteShipmentFilterHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const filterId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(filterId)) {
    return c.json({ error: 'Invalid filter id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  try {
    await executeSql(
      resolved.connectionString,
      'DELETE FROM longhaul_shipment_filter WHERE filter_id = @id',
      { params: [{ name: 'id', value: filterId }] },
    )
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud delete shipment filter failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to delete filter', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

function errDetail(err: unknown): string {
  return err instanceof MssqlExecError ? err.message : String(err)
}
