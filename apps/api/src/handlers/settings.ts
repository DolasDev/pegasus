// ---------------------------------------------------------------------------
// Tenant settings handler — /api/v1/settings
//
// Lets tenant administrators manage tenant-level configuration such as the
// legacy MSSQL connection string. All endpoints require the tenant_admin role.
//
// Endpoints:
//   GET   /mssql  — returns the current MSSQL connection string (password masked)
//   PATCH /mssql  — updates or clears the MSSQL connection string
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requireRole } from '../middleware/rbac'
import { db } from '../db'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PatchMssqlBody = z.object({
  mssqlConnectionString: z.string().min(1).nullable(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskConnectionString(str: string | null): string | null {
  if (!str) return str
  return str.replace(/Password=([^;]*)/i, 'Password=****')
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const settingsHandler = new Hono<AppEnv>()

// All endpoints require tenant_admin.
settingsHandler.use('*', requireRole(['tenant_admin']))

// ---------------------------------------------------------------------------
// GET /mssql
//
// Returns the current MSSQL connection string with password masked.
//
// Response: { data: { mssqlConnectionString: string | null } }
// ---------------------------------------------------------------------------
settingsHandler.get('/mssql', async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }

  return c.json({ data: { mssqlConnectionString: maskConnectionString(tenant.mssqlConnectionString) } })
})

// ---------------------------------------------------------------------------
// PATCH /mssql
//
// Updates or clears the MSSQL connection string. Pass null to clear.
//
// Request:  { mssqlConnectionString: string | null }
// Response: { data: { mssqlConnectionString: string | null } }
// ---------------------------------------------------------------------------
settingsHandler.patch(
  '/mssql',
  validator('json', (value, c) => {
    const r = PatchMssqlBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const { mssqlConnectionString } = c.req.valid('json')

    const tenant = await db.tenant.update({
      where: { id: tenantId },
      data: { mssqlConnectionString },
      select: { mssqlConnectionString: true },
    })

    logger.info('MSSQL connection string updated', { tenantId })
    return c.json({ data: { mssqlConnectionString: maskConnectionString(tenant.mssqlConnectionString) } })
  },
)
