// ---------------------------------------------------------------------------
// Endpoint tests for POST /api/v1/integrations/:integrationId/map-to-external.
//
// Mirrors validate.test.ts: the REAL apiClientAuthMiddleware runs, authorized
// cases use the DB-free platform-key path (a token whose SHA-256 matches the
// env-injected VPN_AGENT_APIKEY_HASH).
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

const PATH = '/api/v1/integrations/demo_partner/map-to-external'

// A known-valid demo_partner order (mirrors __corpus__/demo_partner/01-valid-accepted).
const validDemoPartnerOrder = {
  Id: 'SHIP-1',
  InvolvedParties: {
    ShipperEmployer: { Identity: { Description: 'O-60232' } },
    Coordinator: {
      Identity: { Description: 'Suzanne Polo' },
      EmailAddress: 'noreply@demopartner.example',
    },
  },
  Survey: { SerivceStatus: 'Accepted', Storage1stDay: 100, GeneralComments: 'ok' },
  DocumentationDates: ['2024-05-25'],
  KeyMoveDates: { Survey: { Planned: '2024-05-25' } },
  Financials: { EstimatedWeight: 5000, ActualWeight: null },
}

describe('POST /integrations/:integrationId/map-to-external', () => {
  beforeAll(() => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
  })
  afterAll(() => {
    delete process.env['VPN_AGENT_APIKEY_HASH']
  })

  it('returns 401 when no API key is supplied', async () => {
    const res = await post(PATH, { data: validDemoPartnerOrder })
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns the external payload + valid:true for a clean order', async () => {
    const res = await post(PATH, { action: 'save', data: validDemoPartnerOrder }, authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      external: Record<string, unknown>
      valid: boolean
      issues: unknown[]
      degraded: boolean
    }
    expect(body).toMatchObject({ valid: true, issues: [], degraded: false })
    expect(body.external).toMatchObject({
      serviceOrderNumber: 'O-60232',
      serviceStatus: 'Accepted',
    })
    expect((body.external['shipments'] as unknown[]).length).toBe(1)
  })

  it('returns the external payload + valid:false for a rule violation', async () => {
    const res = await post(
      PATH,
      { action: 'save', data: { ...validDemoPartnerOrder, Survey: { SerivceStatus: 'Awarded' } } },
      authed(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      external: Record<string, unknown>
      valid: boolean
      issues: Array<{ ruleId: string; field: string }>
    }
    expect(body.valid).toBe(false)
    // The payload is still produced — the caller gates the send on `valid`.
    expect(body.external).toMatchObject({ serviceStatus: 'Awarded' })
    expect(body.issues).toContainEqual(
      expect.objectContaining({ ruleId: 'service-status-not-supplier-settable' }),
    )
  })

  it('returns 404 for an unknown integration (after auth passes)', async () => {
    const res = await post('/api/v1/integrations/ghost/map-to-external', { data: {} }, authed())
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
