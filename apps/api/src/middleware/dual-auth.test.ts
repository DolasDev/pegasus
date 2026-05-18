// ---------------------------------------------------------------------------
// Unit tests for dualAuthMiddleware
//
// The three downstream middlewares are mocked with pass-through stubs — this
// suite asserts only the dispatch decision (which middleware gets the request),
// not what each downstream middleware does. Their behaviour is covered by
// tenant-middleware.test.ts and m2m-app-auth.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const { mockTenant, mockM2m, mockSkip } = vi.hoisted(() => ({
  mockTenant: vi.fn(),
  mockM2m: vi.fn(),
  mockSkip: vi.fn(),
}))

vi.mock('./tenant', () => ({ tenantMiddleware: mockTenant }))
vi.mock('./m2m-app-auth', () => ({ m2mAppAuthMiddleware: mockM2m }))
vi.mock('./skip-auth', () => ({ skipAuthMiddleware: mockSkip }))

import { dualAuthMiddleware } from './dual-auth'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', dualAuthMiddleware)
  app.get('/', (c) => c.json({ ok: true }))
  return app
}

describe('dualAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['SKIP_AUTH']
    // Pass-through stubs so the request reaches the route handler.
    mockTenant.mockImplementation(async (_c, next) => {
      await next()
    })
    mockM2m.mockImplementation(async (_c, next) => {
      await next()
    })
    mockSkip.mockImplementation(async (_c, next) => {
      await next()
    })
  })

  afterEach(() => {
    delete process.env['SKIP_AUTH']
  })

  it('dispatches a vnd_ bearer token to m2mAppAuthMiddleware', async () => {
    const res = await buildApp().request('/', {
      headers: { Authorization: 'Bearer vnd_abc123def456' },
    })
    expect(res.status).toBe(200)
    expect(mockM2m).toHaveBeenCalledOnce()
    expect(mockTenant).not.toHaveBeenCalled()
    expect(mockSkip).not.toHaveBeenCalled()
  })

  it('dispatches a non-vnd_ bearer token (Cognito JWT) to tenantMiddleware', async () => {
    await buildApp().request('/', { headers: { Authorization: 'Bearer eyJhbGci.payload.sig' } })
    expect(mockTenant).toHaveBeenCalledOnce()
    expect(mockM2m).not.toHaveBeenCalled()
    expect(mockSkip).not.toHaveBeenCalled()
  })

  it('dispatches a request with no Authorization header to tenantMiddleware', async () => {
    await buildApp().request('/')
    expect(mockTenant).toHaveBeenCalledOnce()
    expect(mockM2m).not.toHaveBeenCalled()
  })

  it('routes every request to skipAuthMiddleware when SKIP_AUTH=true', async () => {
    process.env['SKIP_AUTH'] = 'true'
    await buildApp().request('/', { headers: { Authorization: 'Bearer vnd_abc123def456' } })
    expect(mockSkip).toHaveBeenCalledOnce()
    expect(mockM2m).not.toHaveBeenCalled()
    expect(mockTenant).not.toHaveBeenCalled()
  })
})
