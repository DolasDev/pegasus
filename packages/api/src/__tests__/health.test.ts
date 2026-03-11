// ---------------------------------------------------------------------------
// Tests for the /health endpoint
//
// Covers:
//   - Basic health check returns { status: 'ok' }
//   - Deep health check (?deep=true) runs SELECT 1 and returns db status
//   - Deep health check returns 503 when the database is unreachable
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
}))

vi.mock('../db', () => ({
  db: { $queryRaw: mockQueryRaw, $disconnect: vi.fn() },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})),
}))

// Mock jose so tenant middleware doesn't fail on import
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  errors: { JWTExpired: class JWTExpired extends Error {} },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/health endpoint', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset()
    process.env['SKIP_AUTH'] = 'true'
  })

  it('returns 200 with status ok for basic health check', async () => {
    const { app } = await import('../app')
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('ok')
    expect(body['timestamp']).toBeDefined()
    // Should NOT include db field on basic check
    expect(body['db']).toBeUndefined()
  })

  it('returns 200 with db ok for deep health check when DB is reachable', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])

    const { app } = await import('../app')
    const res = await app.request('/health?deep=true')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('ok')
    expect(body['db']).toBe('ok')
  })

  it('returns 503 with db error for deep health check when DB is unreachable', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('Connection refused'))

    const { app } = await import('../app')
    const res = await app.request('/health?deep=true')
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('degraded')
    expect(body['db']).toBe('error')
  })
})
