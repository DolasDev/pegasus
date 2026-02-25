// ---------------------------------------------------------------------------
// Unit tests for requireRole RBAC middleware
//
// The Hono context is seeded with a `role` variable via a preceding middleware
// in the test app. No mocks are needed — requireRole is a pure middleware
// with no external dependencies.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireRole } from './rbac'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

/**
 * Builds a minimal Hono app that:
 *  1. Seeds `role` in context via a preceding middleware (undefined = not set)
 *  2. Applies `requireRole(allowedRoles)`
 *  3. Exposes a /probe endpoint that returns 200 if the middleware passes
 */
function buildApp(role: string | undefined, allowedRoles: string[]) {
  const app = new Hono<AppEnv>()

  // Seed the role context variable before requireRole runs.
  app.use('*', async (c, next) => {
    if (role !== undefined) {
      c.set('role', role)
    }
    await next()
  })

  app.use('*', requireRole(allowedRoles))

  app.get('/probe', (c) => c.json({ ok: true }))

  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  // ── 403 cases ─────────────────────────────────────────────────────────────

  it('returns 403 FORBIDDEN when no role is set in context', async () => {
    const res = await buildApp(undefined, ['tenant_admin']).request('/probe')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when the role does not match the single allowed role', async () => {
    const res = await buildApp('tenant_user', ['tenant_admin']).request('/probe')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when the role matches none of several allowed roles', async () => {
    const res = await buildApp('guest', ['tenant_admin', 'tenant_manager']).request('/probe')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when allowedRoles is empty (no role can ever pass)', async () => {
    const res = await buildApp('tenant_admin', []).request('/probe')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  // ── 200 — happy path ──────────────────────────────────────────────────────

  it('calls next() and returns 200 when the role exactly matches the single allowed role', async () => {
    const res = await buildApp('tenant_admin', ['tenant_admin']).request('/probe')
    expect(res.status).toBe(200)
    expect((await json(res)).ok).toBe(true)
  })

  it('calls next() and returns 200 when the role matches one of several allowed roles', async () => {
    const res = await buildApp('tenant_manager', ['tenant_admin', 'tenant_manager']).request('/probe')
    expect(res.status).toBe(200)
    expect((await json(res)).ok).toBe(true)
  })
})
