// ---------------------------------------------------------------------------
// Unit tests for requestTimingMiddleware
//
// Verifies that:
//  - A `request.completed` log line is emitted with route, status, durationMs.
//  - The per-downstream breakdown reflects recordDownstream calls in handlers.
//  - The line is still emitted when the handler throws.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requestTimingMiddleware } from './request-timing'
import { recordDownstream } from '../lib/request-timing'
import { logger } from '../lib/logger'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestTimingMiddleware)
  app.get('/customers/:id', async (c) => {
    await recordDownstream('db', () => new Promise((r) => setTimeout(r, 5)))
    return c.json({ id: c.req.param('id') })
  })
  app.get('/boom', () => {
    throw new Error('handler exploded')
  })
  return app
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestTimingMiddleware', () => {
  it('emits a request.completed line with route, status and durationMs', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = buildApp()

    const res = await app.request('/customers/abc')
    expect(res.status).toBe(200)

    const call = spy.mock.calls.find(([msg]) => msg === 'request.completed')
    expect(call).toBeDefined()
    const fields = call![1] as Record<string, unknown>
    expect(fields['route']).toBe('/customers/:id')
    expect(fields['status']).toBe(200)
    expect(typeof fields['durationMs']).toBe('number')
  })

  it('captures the per-downstream breakdown from handler recordDownstream calls', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = buildApp()

    await app.request('/customers/abc')

    const fields = spy.mock.calls.find(([msg]) => msg === 'request.completed')![1] as Record<
      string,
      number
    >
    expect(fields['dbCalls']).toBe(1)
    expect(fields['dbMs']).toBeGreaterThanOrEqual(0)
    expect(fields['mssqlCalls']).toBe(0)
    expect(fields['tunnelCalls']).toBe(0)
  })

  // Identity attribution: without these, a user reporting "I get errors" cannot
  // be matched to their own failures among every other tenant's (2026-09-17).
  it('attributes the request to the authenticated user and tenant', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = new Hono<AppEnv>()
    app.use('*', requestTimingMiddleware)
    // Mirrors tenantMiddleware, which sets these AFTER this middleware entered
    // — so the log line can only read them in its `finally`.
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-uuid-1')
      c.set('userId', 'tenant-user-uuid-1')
      c.set('principal', { sub: 'cognito-sub-1', tenantId: 'tenant-uuid-1', roleNames: [] })
      await next()
    })
    app.get('/moves', (c) => c.json({ ok: true }))

    await app.request('/moves')

    const fields = spy.mock.calls.find(([msg]) => msg === 'request.completed')![1] as Record<
      string,
      unknown
    >
    expect(fields['tenantId']).toBe('tenant-uuid-1')
    expect(fields['userId']).toBe('tenant-user-uuid-1')
    expect(fields['sub']).toBe('cognito-sub-1')
  })

  it('omits identity fields entirely on an unauthenticated request', async () => {
    // Absent, not null — a null would look like a resolved-but-empty identity.
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = buildApp()

    await app.request('/customers/abc')

    const fields = spy.mock.calls.find(([msg]) => msg === 'request.completed')![1] as Record<
      string,
      unknown
    >
    expect('tenantId' in fields).toBe(false)
    expect('userId' in fields).toBe(false)
    expect('sub' in fields).toBe(false)
  })

  it('never logs the user email, only opaque ids', async () => {
    // PII guard: this line is high-volume and long-retained.
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = new Hono<AppEnv>()
    app.use('*', requestTimingMiddleware)
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-uuid-1')
      c.set('userId', 'tenant-user-uuid-1')
      c.set('principal', { sub: 'cognito-sub-1', tenantId: 'tenant-uuid-1', roleNames: [] })
      await next()
    })
    app.get('/moves', (c) => c.json({ ok: true }))

    await app.request('/moves')

    const fields = spy.mock.calls.find(([msg]) => msg === 'request.completed')![1] as Record<
      string,
      unknown
    >
    expect(JSON.stringify(fields)).not.toContain('@')
  })

  it('still emits the timing line when the handler throws', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const app = buildApp()
    // Hono catches an unhandled throw and returns a 500; the middleware's
    // finally must still emit the timing line on that path.
    const res = await app.request('/boom')
    expect(res.status).toBe(500)

    const call = spy.mock.calls.find(([msg]) => msg === 'request.completed')
    expect(call).toBeDefined()
    expect((call![1] as Record<string, unknown>)['route']).toBe('/boom')
  })
})
