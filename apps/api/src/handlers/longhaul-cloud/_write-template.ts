// ---------------------------------------------------------------------------
// CLOUD-WRITE HANDLER TEMPLATE (Phase 4) — copy this, don't mount it.
//
// This is the canonical shape every cloud-direct longhaul WRITE handler in
// Units 1–5 follows. It is NOT registered in app.ts; the leading underscore
// keeps it out of the route table. It exists so the pattern compiles + lives
// in one place. Delete or ignore once the real handlers exist.
//
// The four steps, in order:
//   1. Validate the request (Zod) and parse path params. 400 on bad input.
//   2. Resolve the acting legacy user via resolveLonghaulUser — this also
//      hands back the tenant connection string and enforces 401/403/422/503
//      parity with the proxy's longhaul-user middleware. The salesman `code`
//      stamps audit columns (created_by_id / updated_by_id / modified_by).
//   3. Author parameterized SQL (named @params) and run ONE executeSql. If the
//      write touches >1 row/table, wrap it in the in-SQL transaction batch
//      (SET XACT_ABORT ON / BEGIN TRY … BEGIN TRAN … COMMIT … CATCH ROLLBACK;
//      THROW) and end with a trailing SELECT of the written row — proven safe
//      in Unit 0 (commit round-trips; errors roll back and surface).
//   4. Return the written row (Phase 3 lesson: assert the row, not just shape).
//
// Soft-fail any OPTIONAL table (the Phase 3.1 `pegasus_extra_location` lesson):
// never let an absent table abort the mandatory batch.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { logger } from '../../lib/logger'

const Body = z.object({
  someValue: z.string().nullable(),
})

// Single parameterized statement. OUTPUT returns the written row in one round
// trip (verify no INSTEAD OF/AFTER trigger on the target before relying on it).
const UPDATE_SQL = `
UPDATE ExampleTable
SET some_value = @someValue,
    modified_by = @code
OUTPUT INSERTED.*
WHERE id = @id
`

export const longhaulWriteTemplateHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  // 1. Validate.
  const id = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = Body.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  // 2. Resolve the acting legacy user (+ connection string, + auth parity).
  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }
  const { connectionString, code } = resolved

  // 3 + 4. Run the parameterized write; return the written row.
  try {
    const { recordset } = await executeSql(connectionString, UPDATE_SQL, {
      params: [
        { name: 'id', value: id },
        { name: 'someValue', value: parsed.data.someValue },
        { name: 'code', value: code },
      ],
    })
    const row = recordset[0] as Record<string, unknown> | undefined
    if (!row) {
      return c.json({ error: 'Not found', code: 'NOT_FOUND', correlationId }, 404)
    }
    return c.json({ data: row })
  } catch (err) {
    // executeSql throws MssqlExecError(EXECUTOR_QUERY_ERROR) carrying the real
    // SQL message when the (possibly transactional) batch rolls back.
    const detail = err instanceof MssqlExecError ? err.message : String(err)
    logger.error('longhaul cloud write-template failed', { error: detail })
    return c.json({ error: 'Failed to write', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}
