import type { MiddlewareHandler } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import { getPool } from '../../lib/mssql'
import { db } from '../../db'
import { logger } from '../../lib/logger'

export const mssqlMiddleware: MiddlewareHandler<OnPremEnv> = async (c, next) => {
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

  const pool = await getPool(tenant.mssqlConnectionString)
  c.set('mssqlPool', pool)

  await next()
}
