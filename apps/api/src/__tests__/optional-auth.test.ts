// ---------------------------------------------------------------------------
// Tests for SKIP_AUTH behaviour
//
// When SKIP_AUTH=true, the tenant middleware is bypassed and stub context
// values (tenantId, role, db) are set so handlers still work.
//
// Because the SKIP_AUTH check happens at module evaluation time (the v1
// sub-router is configured once), each test imports a fresh app module via
// vi.resetModules().
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    tenantUser: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})),
}))

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
  jwtVerify: vi.fn().mockRejectedValue(new Error('no token')),
  errors: { JWTExpired: class JWTExpired extends Error {} },
}))

describe('SKIP_AUTH mode', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key]
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      process.env[key] = val
    }
  })

  it('bypasses auth and returns 200 on /api/v1 routes when SKIP_AUTH=true', async () => {
    process.env['SKIP_AUTH'] = 'true'

    const { app } = await import('../app')

    // Request a v1 route without any auth headers — should pass through
    const res = await app.request('/api/v1/customers')
    // Might be 200 or 404 depending on handler, but NOT 401
    expect(res.status).not.toBe(401)
  })

  it('returns 401 on /api/v1 routes without auth when SKIP_AUTH is not set', async () => {
    delete process.env['SKIP_AUTH']

    const { app } = await import('../app')

    const res = await app.request('/api/v1/customers')
    expect(res.status).toBe(401)
  })

  it('sets stub context values when SKIP_AUTH=true', async () => {
    process.env['SKIP_AUTH'] = 'true'
    process.env['DEFAULT_TENANT_ID'] = 'test-tenant-id'

    const { app } = await import('../app')

    // We can't directly inspect context, but we can verify the health
    // endpoint works (proving the app boots) and a v1 route doesn't 401
    const healthRes = await app.request('/health')
    expect(healthRes.status).toBe(200)

    const v1Res = await app.request('/api/v1/customers')
    expect(v1Res.status).not.toBe(401)
  })
})
