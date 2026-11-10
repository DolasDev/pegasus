// The streaming assistant Lambda sits behind a PUBLIC Function URL. Its entry
// must serve only /api/v1/assistant/*, so that URL can't be used to reach the
// rest of the API around API Gateway's stage throttle.

import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('../app', async () => {
  const { Hono } = await import('hono')
  const app = new Hono()
  app.all('*', (c) => c.json({ reached: new URL(c.req.url).pathname }))
  return { app }
})

let assistantOnlyApp: { request: (p: string) => Response | Promise<Response> }

beforeAll(async () => {
  process.env['DATABASE_URL'] ??= 'postgres://test'
  process.env['COGNITO_JWKS_URL'] ??= 'https://example.com/.well-known/jwks.json'
  process.env['COGNITO_TENANT_CLIENT_ID'] ??= 'client'
  process.env['COGNITO_USER_POOL_ID'] ??= 'pool'
  // streamHandle reads the Lambda runtime's `awslambda` global at import time.
  ;(globalThis as Record<string, unknown>)['awslambda'] = {
    streamifyResponse: (fn: unknown) => fn,
    HttpResponseStream: { from: (s: unknown) => s },
  }
  ;({ assistantOnlyApp } = await import('../lambda-assistant'))
})

describe('lambda-assistant path guard', () => {
  it.each(['/api/v1/assistant/chat', '/api/v1/assistant/tools', '/api/v1/assistant'])(
    'forwards %s to the app',
    async (path) => {
      const res = await assistantOnlyApp.request(path)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ reached: path })
    },
  )

  it.each([
    '/api/v1/moves',
    '/api/v1/onprem/longhaul/shipments',
    '/api/v1/assistantx/chat',
    '/api/admin/tenants',
    '/health',
  ])('refuses %s', async (path) => {
    const res = await assistantOnlyApp.request(path)
    expect(res.status).toBe(404)
  })
})
