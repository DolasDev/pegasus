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
