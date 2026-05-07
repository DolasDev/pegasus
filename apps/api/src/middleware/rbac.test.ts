// ---------------------------------------------------------------------------
// Unit tests for requirePermission RBAC middleware (Cedar/AVP-backed).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requirePermission } from './rbac'
import { Actions, type ActionDef } from '../authz/actions'
import { _clearAuthzCache } from '../lib/authz'
import { seedPrincipal } from '../__tests__/_principal'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

// ---------------------------------------------------------------------------
// requirePermission — Cedar/AVP-backed authorisation middleware
// ---------------------------------------------------------------------------

function buildPermissionApp(roleNames: string[], action: ActionDef = Actions.InviteUser) {
  const app = new Hono<AppEnv>()
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', requirePermission(action))
  app.get('/probe', (c) => c.json({ ok: true }))
  return app
}

describe('requirePermission', () => {
  beforeEach(() => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
  })

  it('returns 200 when tenant_admin invokes a write action', async () => {
    const res = await buildPermissionApp(['tenant_admin']).request('/probe')
    expect(res.status).toBe(200)
  })

  it('returns 403 FORBIDDEN when tenant_user invokes a write action', async () => {
    const res = await buildPermissionApp(['tenant_user']).request('/probe')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 200 when tenant_user invokes a read action they have access to', async () => {
    const res = await buildPermissionApp(['tenant_user'], Actions.ReadQuote).request('/probe')
    expect(res.status).toBe(200)
  })

  it('returns 403 FORBIDDEN for an empty-roles principal', async () => {
    const res = await buildPermissionApp([]).request('/probe')
    expect(res.status).toBe(403)
  })
})
