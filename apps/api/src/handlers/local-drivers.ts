// ---------------------------------------------------------------------------
// GET /api/v1/local-drivers — active local drivers from the tenant's legacy
// `crews` table, for the Settings → Users picker that maps a login to its local
// driver id (TenantUser.localDriverEmployeeId). The mapping lets that login
// reach the move chats of the local jobs it drives (plans/in-progress/
// move-chat-api.md, D2). Gated like the edit it serves: UpdateUser.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { legacyConnectionString, listLocalDrivers } from '../lib/chat-access'
import { logger } from '../lib/logger'

export const localDriversHandler = new Hono<AppEnv>()

localDriversHandler.get('/', requirePermission(Actions.UpdateUser), async (c) => {
  const correlationId = c.get('correlationId')
  const cs = await legacyConnectionString(c.get('tenantId'))
  if (!cs) {
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }
  try {
    return c.json({ data: await listLocalDrivers(cs) })
  } catch (err) {
    logger.error('local drivers lookup failed', { error: String(err) })
    return c.json(
      { error: 'Failed to fetch local drivers', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
})
