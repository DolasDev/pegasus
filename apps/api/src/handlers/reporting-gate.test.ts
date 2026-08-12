// ---------------------------------------------------------------------------
// The REPORTING_ENABLED gate, asserted through the REAL mount shape.
//
// reporting-dashboards.test.ts mounts the dashboards router directly, so it
// cannot see this: the gate lives on the PARENT (reportingHandler) and reaches
// /dashboards only because Hono merges a sub-app's routes into its parent and
// applies middleware registered before them.
//
// That is a load-bearing assumption about a library's merge order, and the thing
// it protects is a whole unreleased authoring API. Assert it against the same
// composition app.ts uses rather than reasoning about it.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

vi.mock('../lib/authz', () => ({
  listAllowedPermissions: vi.fn().mockResolvedValue(['report:read', 'dashboard:manage']),
}))
vi.mock('../middleware/rbac', () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

import { reportingHandler } from './reporting'

/** Composed exactly as app.ts composes it: ONE sub-app owning /reporting. */
function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-1')
    c.set('correlationId', 'corr-1')
    c.set('principal', { sub: 's', tenantId: 'tenant-1', roleNames: ['tenant_admin'] })
    c.set('db', {} as never)
    await next()
  })
  app.route('/reporting', reportingHandler)
  return app
}

beforeEach(() => {
  delete process.env['REPORTING_ENABLED']
})

afterEach(() => {
  delete process.env['REPORTING_ENABLED']
})

describe('REPORTING_ENABLED gate covers the whole /reporting prefix', () => {
  const paths: Array<[string, string]> = [
    ['GET', '/reporting/datasets'],
    ['POST', '/reporting/query'],
    ['GET', '/reporting/dashboards'],
    ['GET', '/reporting/dashboards/ops'],
    ['POST', '/reporting/dashboards'],
    ['POST', '/reporting/dashboards/ops/fork'],
    ['DELETE', '/reporting/dashboards/ops'],
  ]

  for (const [method, path] of paths) {
    it(`404s ${method} ${path} when the flag is off`, async () => {
      const res = await buildApp().request(path, {
        method,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
      })
      expect(res.status).toBe(404)
      expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND')
    })
  }

  it('lets a request through once the flag is on', async () => {
    // Proves the 404s above are the GATE and not simply an unrouted path —
    // without this, a typo in a route would make every assertion pass.
    process.env['REPORTING_ENABLED'] = 'true'
    const res = await buildApp().request('/reporting/datasets')
    expect(res.status).toBe(200)
  })
})
