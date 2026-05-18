// ---------------------------------------------------------------------------
// SKIP_AUTH synthetic-context middleware
//
// When SKIP_AUTH=true (local / on-prem development only) authentication is
// bypassed entirely and a synthetic tenant_admin principal is injected so
// handlers — and requirePermission — can run without Cognito or a vendor key.
//
// Extracted from app.ts so the bypass behaves identically on every route,
// whether mounted directly under the Cognito v1 router or reached through
// dualAuthMiddleware (see middleware/dual-auth.ts).
//
// NEVER enable SKIP_AUTH in a production deployment.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db as basePrisma } from '../db'

/**
 * Hono middleware that populates the AppEnv context with a synthetic
 * tenant_admin principal. The resolved tenant is `DEFAULT_TENANT_ID` (or the
 * literal `default-tenant` placeholder when that env var is unset).
 *
 * `db` is the unscoped base Prisma client — the tenant query extension is not
 * applied under SKIP_AUTH, matching the legacy inline behaviour in app.ts.
 */
export async function skipAuthMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
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
}
