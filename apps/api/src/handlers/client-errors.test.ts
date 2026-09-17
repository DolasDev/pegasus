// ---------------------------------------------------------------------------
// Unit tests for the client-error reporting handler.
//
// The point of this endpoint is that a browser-side crash stops being invisible,
// so the assertions are about what lands in the log line — not about a response
// body, which deliberately does not exist.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { clientErrorsHandler } from './client-errors'
import { logger } from '../lib/logger'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.route('/client-errors', clientErrorsHandler)
  return app
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

type LoggerSpy = { mock: { calls: unknown[][] } }

function loggedFields(spy: LoggerSpy): Record<string, unknown> {
  const call = spy.mock.calls.find((args) => args[0] === 'client.error')
  expect(call).toBeDefined()
  return call![1] as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /client-errors', () => {
  it('returns 204 with no body on a valid report', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})

    const res = await buildApp().request(
      '/client-errors',
      post({ message: 'Cannot read properties of undefined' }),
    )

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('logs the crash at ERROR with every reported field', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    await buildApp().request(
      '/client-errors',
      post({
        message: 'Failed to fetch dynamically imported module: /assets/TripsModule-DSvmpdaq.js',
        stack: 'TypeError: Failed to fetch\n  at loadTrips (index-abc.js:1:2)',
        componentStack: '\n    at TripsModule\n    at Operations',
        url: 'https://pegasus.dolas.dev/operations/trips',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      }),
    )

    const fields = loggedFields(spy)
    // The chunk name is what identifies a stale-bundle crash.
    expect(fields['clientMessage']).toContain('TripsModule-DSvmpdaq.js')
    expect(fields['stack']).toContain('loadTrips')
    expect(fields['componentStack']).toContain('TripsModule')
    expect(fields['url']).toBe('https://pegasus.dolas.dev/operations/trips')
    expect(fields['userAgent']).toContain('Windows')
  })

  it('omits optional fields that were not reported', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    await buildApp().request('/client-errors', post({ message: 'boom' }))

    const fields = loggedFields(spy)
    expect('stack' in fields).toBe(false)
    expect('componentStack' in fields).toBe(false)
    expect('url' in fields).toBe(false)
  })

  it('truncates oversized fields instead of dropping the report', async () => {
    // A looping client must not be able to write an unbounded string into a log
    // line we pay to store — but the report is still the only evidence of the
    // crash, so it is capped rather than rejected.
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const res = await buildApp().request(
      '/client-errors',
      post({ message: 'x'.repeat(5000), stack: 'y'.repeat(20000) }),
    )

    expect(res.status).toBe(204)
    const fields = loggedFields(spy)
    expect((fields['clientMessage'] as string).length).toBe(500)
    expect((fields['stack'] as string).length).toBe(4000)
  })

  it('returns 400 when the report carries no message', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const res = await buildApp().request('/client-errors', post({ stack: 'no message here' }))

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
    expect(spy.mock.calls.find(([m]) => m === 'client.error')).toBeUndefined()
  })

  it('returns 400 on an empty message rather than logging a blank line', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})

    const res = await buildApp().request('/client-errors', post({ message: '' }))

    expect(res.status).toBe(400)
  })
})
