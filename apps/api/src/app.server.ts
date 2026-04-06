// ---------------------------------------------------------------------------
// On-prem app — extends the base app with MSSQL-dependent routes.
//
// These routes require knex (longhaul) or mssql (pegii/efwk) which are only
// available in on-prem deployments against a local SQL Server instance.
// They are excluded from the Lambda bundle to avoid bundling native drivers.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from './types'
import { app } from './app'
import { tenantMiddleware } from './middleware/tenant'
import { pegiiRouter } from './handlers/pegii'
import { efwkRouter } from './handlers/efwk'
import { longhaulRouter } from './handlers/longhaul'
import { logger } from './lib/logger'
import { db as basePrisma } from './db'

const onprem = new Hono<AppEnv>()

if (process.env['SKIP_AUTH'] === 'true') {
  logger.warn('SKIP_AUTH is enabled — all authentication is bypassed. Do NOT use in production.')
  onprem.use('*', async (c, next) => {
    c.set('tenantId', process.env['DEFAULT_TENANT_ID'] ?? 'default-tenant')
    c.set('role', 'tenant_admin')
    c.set('userId', 'skip-auth-user')
    c.set('db', basePrisma as unknown as PrismaClient)
    await next()
  })
} else {
  onprem.use('*', tenantMiddleware)
}

onprem.route('/pegii', pegiiRouter)
onprem.route('/efwk', efwkRouter)
onprem.route('/longhaul', longhaulRouter)

app.route('/api/v1', onprem)

export { app }
