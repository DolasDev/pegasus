// ---------------------------------------------------------------------------
// Endpoint tests for POST /api/v1/integrations/:integrationId/validate.
//
// Auth is exercised with the REAL apiClientAuthMiddleware. The authorized cases
// use the platform-key path (DB-free: a token whose SHA-256 matches the
// env-injected VPN_AGENT_APIKEY_HASH) so no Postgres lookup is needed. The
// tenant-key DB path is covered by middleware/api-client-auth.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { integrationValidationHandler } from './validate'

const PLATFORM_TOKEN = 'vnd_test_platform_key'
const PLATFORM_HASH = crypto.createHash('sha256').update(PLATFORM_TOKEN).digest('hex')

function buildApp() {
  const app = new Hono<{ Variables: { correlationId: string } }>()
  app.use('*', async (c, next) => {
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.route('/api/v1', integrationValidationHandler)
  return app
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return buildApp().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const authed = (token: string = PLATFORM_TOKEN) => ({ Authorization: `Bearer ${token}` })

const PATH = '/api/v1/integrations/longhaul/validate'

describe('POST /integrations/:integrationId/validate', () => {
  beforeAll(() => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
  })
  afterAll(() => {
    delete process.env['VPN_AGENT_APIKEY_HASH']
  })

  it('returns 401 when no API key is supplied', async () => {
    const res = await post(PATH, { order: { TripStatus_id: 1, shipments: [{ order_num: 1 }] } })
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns 401 for a non-vnd_ token (e.g. a Cognito JWT)', async () => {
    const res = await post(PATH, { order: {} }, authed('eyJhbGciOi'))
    expect(res.status).toBe(401)
  })

  it('returns 200 valid:true for a clean order with a valid key', async () => {
    const res = await post(
      PATH,
      { action: 'save', order: { TripStatus_id: 1, shipments: [{ order_num: 1 }] } },
      authed(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ valid: true, issues: [], degraded: false })
  })

  it('returns 200 valid:false with field-mapped issues for a rule violation', async () => {
    const res = await post(
      PATH,
      { action: 'save', order: { TripStatus_id: 1, shipments: [] } },
      authed(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      valid: boolean
      issues: Array<{ ruleId: string; field: string }>
    }
    expect(body.valid).toBe(false)
    expect(body.issues).toEqual([
      expect.objectContaining({ ruleId: 'trip-must-have-shipments', field: 'shipments' }),
    ])
  })

  it('returns 404 for an unknown integration (after auth passes)', async () => {
    const res = await post('/api/v1/integrations/ghost/validate', { order: {} }, authed())
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('returns 400 for a non-JSON body', async () => {
    const res = await buildApp().request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed() },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })
})
