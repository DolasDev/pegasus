// ---------------------------------------------------------------------------
// On-prem app — extends the base app with MSSQL-dependent routes.
//
// These routes require mssql (pegii/efwk) which is only available in on-prem
// deployments against a local SQL Server instance. They are excluded from the
// Lambda bundle to avoid bundling native drivers.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from './types'
import { app } from './app'
import { tenantMiddleware } from './middleware/tenant'
import { pegiiRouter } from './handlers/pegii'
import { efwkRouter } from './handlers/efwk'
import { logger } from './lib/logger'
import { db as basePrisma } from './db'

const onprem = new Hono<AppEnv>()

if (process.env['SKIP_AUTH'] === 'true') {
  logger.warn('SKIP_AUTH is enabled — all authentication is bypassed. Do NOT use in production.')
  process.env['AUTHZ_OFFLINE'] = 'true'
  onprem.use('*', async (c, next) => {
    const tenantId = process.env['DEFAULT_TENANT_ID'] ?? 'default-tenant'
    c.set('tenantId', tenantId)
    c.set('principal', {
      sub: 'skip-auth-user',
      tenantId,
      roleNames: ['tenant_admin'],
    })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('userId', 'skip-auth-user')
    c.set('db', basePrisma as unknown as PrismaClient)
    await next()
  })
} else {
  onprem.use('*', tenantMiddleware)
}

onprem.route('/pegii', pegiiRouter)
onprem.route('/efwk', efwkRouter)

app.route('/api/v1', onprem)

export { app }
