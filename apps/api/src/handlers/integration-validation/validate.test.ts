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

const PATH = '/api/v1/integrations/demo_partner/validate'

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

describe('POST /integrations/:integrationId/validate', () => {
  beforeAll(() => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
  })
  afterAll(() => {
    delete process.env['VPN_AGENT_APIKEY_HASH']
  })

  it('serves the published mapping schema with NO auth (GET mapping-schema)', async () => {
    const res = await buildApp().request('/api/v1/integrations/mapping-schema')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['$schema']).toContain('2020-12')
    expect(body['$id']).toContain('integration-mapping')
  })

  it('serves the inbound-block JSON schema with NO auth (GET inbound-schema)', async () => {
    const res = await buildApp().request('/api/v1/integrations/inbound-schema')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { properties?: Record<string, unknown> }
    expect(body.properties).toHaveProperty('ackTemplate')
    expect(body.properties).toHaveProperty('validation')
  })

  it('lists floors with their canonical fields + fact catalog (GET floors, public)', async () => {
    const res = await buildApp().request('/api/v1/integrations/floors')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ floor: string }> }
    const ids = body.data.map((f) => f.floor)
    expect(ids).toContain('shipment_lifecycle_event')
  })

  it('returns a floor’s machine-readable contract (GET floors/:id, public)', async () => {
    const res = await buildApp().request('/api/v1/integrations/floors/shipment_lifecycle_event')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { floor: string; canonicalFields: string[]; factCatalog: Record<string, string> }
    }
    expect(body.data.floor).toBe('shipment_lifecycle_event')
    // canonicalFields are the legal mapping targets; factCatalog the legal rule facts.
    expect(body.data.canonicalFields).toContain('Reference.Brand')
    expect(body.data.factCatalog).toHaveProperty('brand')
    expect(body.data.factCatalog).toHaveProperty('brandPresent')
  })

  it('exposes a floor’s legal mapping SOURCE roots incl. curated sub-paths (0028)', async () => {
    const res = await buildApp().request('/api/v1/integrations/floors/shipment_status_update')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { inputFieldRoots?: string[] } }
    // The curated UnusedFields survey sub-path is discoverable here, so a config
    // author knows it is readable without hitting the gate blind.
    expect(body.data.inputFieldRoots).toContain('UnusedFields.survey_received')
    // A whole-root grant is listed as a bare key alongside the dotted sub-paths.
    expect(body.data.inputFieldRoots).toContain('Survey')
    // The junk-drawer root itself is NOT opened wholesale.
    expect(body.data.inputFieldRoots).not.toContain('UnusedFields')
  })

  it('exposes the per-date milestone actuals facts (0035) alongside the composites', async () => {
    // This endpoint is how an SDK user discovers the legal rule facts without
    // repo access, so the new per-date facts have to be visible here.
    const res = await buildApp().request('/api/v1/integrations/floors/shipment_status_update')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { factCatalog: Record<string, string> } }
    expect(body.data.factCatalog).toMatchObject({
      shipmentsWithPackActual: 'number',
      shipmentsWithLoadActual: 'number',
      shipmentsWithDeliveryActual: 'number',
      shipmentsWithLoadDeliveryActual: 'number',
      // The composites stay, so already-published configs keep validating.
      shipmentsWithPackLoadActual: 'number',
      shipmentsWithPackLoadDeliveryActual: 'number',
    })
  })

  it('explains what each fact means (factDocs), incl. the same-shipment caveat', async () => {
    // Six shipmentsWith*Actual counts are indistinguishable by name + type, so
    // the floor contract has to carry their semantics or an author guesses.
    const res = await buildApp().request('/api/v1/integrations/floors/shipment_status_update')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { factCatalog: Record<string, string>; factDocs: Record<string, string> }
    }
    expect(Object.keys(body.data.factDocs).sort()).toEqual(
      Object.keys(body.data.factCatalog).sort(),
    )
    expect(body.data.factDocs['shipmentsWithLoadDeliveryActual']).toMatch(/SAME shipment/)
    expect(body.data.factDocs['shipmentsWithLoadDeliveryActual']).toMatch(/independently/)
  })

  it('omits inputFieldRoots for a partner-neutral floor that declares none', async () => {
    const res = await buildApp().request('/api/v1/integrations/floors/shipment_lifecycle_event')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { inputFieldRoots?: string[] } }
    expect(body.data.inputFieldRoots).toBeUndefined()
  })

  it('404s for an unknown floor (GET floors/:id)', async () => {
    const res = await buildApp().request('/api/v1/integrations/floors/nope')
    expect(res.status).toBe(404)
  })

  it('returns 401 when no API key is supplied', async () => {
    const res = await post(PATH, { order: validDemoPartnerOrder })
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns 401 for a non-vnd_ token (e.g. a Cognito JWT)', async () => {
    const res = await post(PATH, { order: {} }, authed('eyJhbGciOi'))
    expect(res.status).toBe(401)
  })

  it('returns 200 valid:true for a clean order with a valid key', async () => {
    const res = await post(PATH, { action: 'save', order: validDemoPartnerOrder }, authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ valid: true, issues: [], degraded: false })
  })

  it('returns 200 valid:false with field-mapped issues for a rule violation', async () => {
    // A supplier may not set serviceStatus to Awarded — the live rejection.
    const res = await post(
      PATH,
      { action: 'save', order: { ...validDemoPartnerOrder, Survey: { SerivceStatus: 'Awarded' } } },
      authed(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      valid: boolean
      issues: Array<{ ruleId: string; field: string }>
    }
    expect(body.valid).toBe(false)
    expect(body.issues).toEqual([
      expect.objectContaining({
        ruleId: 'service-status-not-supplier-settable',
        field: 'serviceStatus',
      }),
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

describe('POST /integrations/:integrationId/map-from-external', () => {
  beforeAll(() => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
  })
  afterAll(() => {
    delete process.env['VPN_AGENT_APIKEY_HASH']
  })

  const MAP_FROM = '/api/v1/integrations/demo_partner/map-from-external'

  it('returns the canonical entity + a passing verdict for a valid native payload', async () => {
    const res = await post(MAP_FROM, { data: validDemoPartnerOrder }, authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      canonical: Record<string, unknown>
      valid: boolean
      issues: unknown[]
      degraded: boolean
    }
    expect(body.valid).toBe(true)
    expect(body.canonical).toMatchObject({ serviceOrderNumber: 'O-60232' })
  })

  it('fails closed with 404 for an unknown integration', async () => {
    const res = await post('/api/v1/integrations/ghost/map-from-external', { data: {} }, authed())
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('returns 401 without an API key', async () => {
    const res = await post(MAP_FROM, { data: {} })
    expect(res.status).toBe(401)
  })

  it('returns 400 for a non-JSON body', async () => {
    const res = await buildApp().request(MAP_FROM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed() },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
