// ---------------------------------------------------------------------------
// Tenant settings handler — /api/v1/settings
//
// Lets tenant administrators manage tenant-level configuration such as the
// legacy MSSQL connection string. All endpoints require the tenant_admin role.
//
// Endpoints:
//   GET   /mssql       — returns the current MSSQL connection string (password masked)
//   PATCH /mssql       — updates or clears the MSSQL connection string
//   POST  /mssql/test  — runs `SELECT 1` over the tunnel to verify connectivity
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { db } from '../db'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import { executeSql, MssqlExecError } from '../lib/mssql-executor-client'
import { AppSettingsPatchSchema, getAppSettings, updateAppSettings } from '../lib/app-settings'

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
// Connection-test result classification
//
// Map the low-level executor failure (a thrown MssqlExecError whose message
// wraps the underlying `mssql` driver error) onto a small set of stable,
// tenant-friendly codes the UI can render. The driver's connect failure looks
// like "Failed to connect to <host>:<port> in 15000ms"; a bad credential looks
// like "Login failed for user '...'". We never echo the raw connection string
// (it carries a password) — only the driver's own message, which doesn't.
// ---------------------------------------------------------------------------

export type MssqlTestCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'CONNECT_TIMEOUT'
  | 'LOGIN_FAILED'
  | 'QUERY_ERROR'
  | 'EXECUTOR_ERROR'

export interface MssqlTestResult {
  ok: boolean
  code: MssqlTestCode
  detail: string
  elapsedMs: number
}

function classifyMssqlError(err: unknown): { code: MssqlTestCode; detail: string } {
  const message = err instanceof Error ? err.message : String(err)

  if (err instanceof MssqlExecError && err.code !== 'EXECUTOR_QUERY_ERROR') {
    // Misconfiguration of the executor itself, or the invoke failed — not a
    // problem the tenant can fix from this card, but surface it honestly.
    return {
      code: 'EXECUTOR_ERROR',
      detail: 'The diagnostic service is unavailable. Contact support@dolas.dev.',
    }
  }

  if (/failed to connect|timeout|ETIMEDOUT|ESOCKET|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return {
      code: 'CONNECT_TIMEOUT',
      detail:
        'Could not reach the SQL Server over the tunnel. Verify the host/port and that the ' +
        'on-prem firewall allows inbound connections from the VPN. ' +
        `(${message.replace(/^QUERY_FAILED:\s*/, '')})`,
    }
  }

  if (/login failed|authentication|password/i.test(message)) {
    return {
      code: 'LOGIN_FAILED',
      detail:
        'Connected to the server, but the credentials were rejected. Check the User Id / Password.',
    }
  }

  return {
    code: 'QUERY_ERROR',
    detail: `The server returned an error: ${message.replace(/^QUERY_FAILED:\s*/, '')}`,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const settingsHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /mssql
//
// Returns the current MSSQL connection string with password masked.
//
// Response: { data: { mssqlConnectionString: string | null } }
// ---------------------------------------------------------------------------
settingsHandler.get('/mssql', requirePermission(Actions.ReadSettings), async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }

  return c.json({
    data: { mssqlConnectionString: maskConnectionString(tenant.mssqlConnectionString) },
  })
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
  requirePermission(Actions.UpdateSettings),
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
    return c.json({
      data: { mssqlConnectionString: maskConnectionString(tenant.mssqlConnectionString) },
    })
  },
)

// ---------------------------------------------------------------------------
// POST /mssql/test
//
// Runs `SELECT 1` against the tenant's configured MSSQL over the WireGuard
// tunnel (via the in-VPC mssql-executor) and reports whether the round-trip
// succeeds. This is the connectivity probe the legacy-database card's
// "Run diagnostic" button calls — it catches tunnel/firewall/credential
// problems that the static connection-string field can't reveal.
//
// Read-only: gated on ReadSettings, the same permission as GET /mssql.
//
// Response: { data: { ok, code, detail, elapsedMs } } — always HTTP 200; the
// pass/fail verdict lives in the body so the UI can render it uniformly.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /app
//
// Returns the tenant-wide UI preferences object hydrated through
// AppSettingsSchema (so brand-new tenants get a fully-shaped default tree even
// before any field has been written). Read-only — gated on ReadSettings.
//
// Response: { data: AppSettings }
// ---------------------------------------------------------------------------
settingsHandler.get('/app', requirePermission(Actions.ReadSettings), async (c) => {
  const tenantId = c.get('tenantId')
  const settings = await getAppSettings(db, tenantId)
  return c.json({ data: settings })
})

// ---------------------------------------------------------------------------
// PATCH /app
//
// Sparse partial update — the body may include any subset of the seven
// sections (dashboard, moves, quotes, customers, dispatch, billing,
// operations). Validates against AppSettingsPatchSchema (strict at the root,
// so a typo'd section name is rejected); merges over the current value
// section-by-section in lib/app-settings.ts.
//
// `operations.longhaulClient` is mirrored into the legacy `Tenant.longhaulClient`
// column on every write so the cloud-direct longhaul handlers
// (handlers/longhaul-cloud/*) — which read the column directly — see the new
// value without being changed in this PR. A follow-up can collapse the column
// once we trust the new path.
//
// Audit: writes a debug-level log line including the patched section keys (no
// values, so secrets-by-accident never end up in logs); the column mirror is
// the durable record of the operations.longhaulClient state change.
//
// Request:  AppSettingsPatch  (validated)
// Response: { data: AppSettings }  (full hydrated object)
// ---------------------------------------------------------------------------
settingsHandler.patch(
  '/app',
  requirePermission(Actions.UpdateSettings),
  validator('json', (value, c) => {
    const r = AppSettingsPatchSchema.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const patch = c.req.valid('json')

    const next = await updateAppSettings(db, tenantId, patch)

    // Mirror operations.longhaulClient → Tenant.longhaulClient column so the
    // longhaul-cloud handlers (which still read the column) pick up the new
    // value immediately. Only writes when the section was part of THIS patch,
    // so a future settings UI editing an unrelated section never touches the
    // mirror. Explicit null clears the column (admin "unconfigure" path).
    if (patch.operations && 'longhaulClient' in patch.operations) {
      const longhaulClient = next.operations.longhaulClient ?? null
      await db.tenant.update({
        where: { id: tenantId },
        data: { longhaulClient },
      })
      logger.info('Tenant longhaul client updated via app settings', {
        tenantId,
        longhaulClient,
      })
    }

    logger.info('App settings updated', {
      tenantId,
      sections: Object.keys(patch),
    })
    return c.json({ data: next })
  },
)

settingsHandler.post('/mssql/test', requirePermission(Actions.ReadSettings), async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })

  if (!tenant?.mssqlConnectionString) {
    const result: MssqlTestResult = {
      ok: false,
      code: 'NOT_CONFIGURED',
      detail: 'No connection string is configured. Add one before running the diagnostic.',
      elapsedMs: 0,
    }
    return c.json({ data: result })
  }

  const startedAt = Date.now()
  try {
    await executeSql(tenant.mssqlConnectionString, 'SELECT 1 AS ok', { timeoutMs: 10_000 })
    const elapsedMs = Date.now() - startedAt
    logger.info('MSSQL connection test succeeded', { tenantId, elapsedMs })
    const result: MssqlTestResult = {
      ok: true,
      code: 'OK',
      detail: `Connected — SELECT 1 returned in ${elapsedMs} ms.`,
      elapsedMs,
    }
    return c.json({ data: result })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    const { code, detail } = classifyMssqlError(err)
    logger.warn('MSSQL connection test failed', { tenantId, code, elapsedMs, error: String(err) })
    const result: MssqlTestResult = { ok: false, code, detail, elapsedMs }
    return c.json({ data: result })
  }
})
