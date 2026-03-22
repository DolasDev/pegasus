// ---------------------------------------------------------------------------
// Tests for the /openapi.json endpoint
//
// Verifies that the endpoint:
//   - Returns HTTP 200
//   - Returns a valid OpenAPI 3.1.0 document
//   - Contains a paths object with documented endpoints
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — same pattern as health.test.ts
// ---------------------------------------------------------------------------

vi.mock('../db', () => ({
  db: { $queryRaw: vi.fn(), $disconnect: vi.fn() },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})),
}))

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  errors: { JWTExpired: class JWTExpired extends Error {} },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /openapi.json', () => {
  it('returns 200', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(200)
  })

  it('returns a document with openapi version 3.1.0', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    const body = (await res.json()) as Record<string, unknown>
    expect(body['openapi']).toBe('3.1.0')
  })

  it('returns a document with info object containing title and version', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    const body = (await res.json()) as Record<string, unknown>
    const info = body['info'] as Record<string, unknown>
    expect(info).toBeDefined()
    expect(typeof info['title']).toBe('string')
    expect(typeof info['version']).toBe('string')
  })

  it('returns a document with a paths object containing /health', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    const body = (await res.json()) as Record<string, unknown>
    const paths = body['paths'] as Record<string, unknown>
    expect(paths).toBeDefined()
    expect(typeof paths).toBe('object')
    expect(paths['/health']).toBeDefined()
  })

  it('returns a document with paths containing /api/v1/customers', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    const body = (await res.json()) as Record<string, unknown>
    const paths = body['paths'] as Record<string, unknown>
    expect(paths['/api/v1/customers']).toBeDefined()
  })

  it('returns JSON content-type', async () => {
    process.env['SKIP_AUTH'] = 'true'
    const { app } = await import('../app')
    const res = await app.request('/openapi.json')
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
