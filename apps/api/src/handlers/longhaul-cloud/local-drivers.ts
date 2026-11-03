// ---------------------------------------------------------------------------
// GET /onprem/longhaul/local-drivers — the tenant's active local drivers
// (legacy `crews`), for the Operations → Itinerary crew picker.
//
// Operations roles only, like `GET /onprem/longhaul/drivers/itinerary` it
// feeds. The same list is served to tenant admins at `/local-drivers` (gated
// by UpdateUser for the Settings → Users mapping); that gate is NOT relaxed —
// this is a separate read for a separate audience (plans/completed/
// 08b7a429-driver-itinerary-mobile.md, decision 3). The ids are the crew numbering
// space; the client never pairs one with a longhaul driver id.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { legacyConnectionString, listLocalDrivers } from '../../lib/chat-access'
import { logger } from '../../lib/logger'
import { hasOperationsRole } from '../../lib/longhaul-read-scope'

export const operationsLocalDriversHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')
  if (!hasOperationsRole(c.get('principal')?.roleNames ?? [])) {
    return c.json(
      { error: 'The crew list needs an Operations role', code: 'FORBIDDEN', correlationId },
      403,
    )
  }
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
    logger.error('operations local drivers lookup failed', { error: String(err) })
    return c.json(
      { error: 'The order database could not be read', code: 'LEGACY_UNAVAILABLE', correlationId },
      503,
    )
  }
}
