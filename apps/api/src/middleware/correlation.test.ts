// ---------------------------------------------------------------------------
// Unit tests for correlationMiddleware
//
// Verifies that:
//  - A correlation ID from the request header is forwarded to the response.
//  - A fresh UUID is generated when no header is present.
//  - The correlation ID is stored in the Hono context for downstream handlers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { correlationMiddleware } from './correlation'

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', correlationMiddleware)
  // Probe endpoint that echoes the correlationId from context.
  app.get('/probe', (c) => c.json({ correlationId: c.get('correlationId') }))
  return app
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('correlationMiddleware', () => {
  it('forwards an incoming x-correlation-id header unchanged', async () => {
    const app = buildApp()
    const id = 'test-correlation-id-123'
    const res = await app.request('/probe', { headers: { 'x-correlation-id': id } })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-correlation-id')).toBe(id)
    const body = (await res.json()) as { correlationId: string }
    expect(body.correlationId).toBe(id)
  })

  it('generates a UUID when no x-correlation-id header is present', async () => {
    const app = buildApp()
    const res = await app.request('/probe')

    expect(res.status).toBe(200)
    const responseId = res.headers.get('x-correlation-id')
    expect(responseId).toMatch(UUID_RE)
    const body = (await res.json()) as { correlationId: string }
    expect(body.correlationId).toBe(responseId)
  })

  it('sets a different correlation ID for each request', async () => {
    const app = buildApp()
    const res1 = await app.request('/probe')
    const res2 = await app.request('/probe')

    const id1 = res1.headers.get('x-correlation-id')
    const id2 = res2.headers.get('x-correlation-id')
    expect(id1).not.toBe(id2)
  })
})
