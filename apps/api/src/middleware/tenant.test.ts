// ---------------------------------------------------------------------------
// Unit tests for tenantMiddleware token-audience handling.
//
// Regression focus: the middleware must accept ID tokens from BOTH Cognito app
// clients — the web app (COGNITO_TENANT_CLIENT_ID) and the mobile driver app
// (COGNITO_MOBILE_CLIENT_ID). It previously verified against the web client
// only, so every mobile /api/v1 request 401'd with "Invalid or unverifiable
// token" (latent until the api-http crypto.randomUUID fix let mobile requests
// reach the API at all).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const { mockJwtVerify } = vi.hoisted(() => ({ mockJwtVerify: vi.fn() }))
vi.mock('jose', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})

const { mockTenantFindUnique, mockTenantUserFindFirst } = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockTenantUserFindFirst: vi.fn(),
}))
vi.mock('../db', () => ({
  db: {
    tenant: { findUnique: mockTenantFindUnique },
    tenantUser: { findFirst: mockTenantUserFindFirst },
  },
}))
vi.mock('../lib/prisma', () => ({ createTenantDb: vi.fn(() => ({})) }))

import { tenantMiddleware } from './tenant'

const TENANT_CLIENT = 'web-client-id'
const MOBILE_CLIENT = 'mobile-client-id'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', tenantMiddleware)
  app.get('/ping', (c) => c.json({ ok: true, userId: c.get('userId') ?? null }))
  return app
}

function idPayload() {
  return {
    token_use: 'id',
    'custom:tenantId': 't1',
    'custom:roles': JSON.stringify(['tenant_admin']),
    sub: 'sub-1',
  }
}

function req(app: ReturnType<typeof buildApp>, token = 'tok') {
  return app.request('/ping', { headers: { Authorization: `Bearer ${token}` } })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['COGNITO_JWKS_URL'] =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool/.well-known/jwks.json'
  process.env['COGNITO_TENANT_CLIENT_ID'] = TENANT_CLIENT
  process.env['COGNITO_MOBILE_CLIENT_ID'] = MOBILE_CLIENT
  mockTenantFindUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE', policyStoreId: 'ps1' })
  mockTenantUserFindFirst.mockResolvedValue({ id: 'tu-1', crewMember: null })
})

describe('tenantMiddleware — token audience', () => {
  it('verifies the token against BOTH the web and mobile client ids', async () => {
    mockJwtVerify.mockResolvedValue({ payload: idPayload() })
    const res = await req(buildApp())
    expect(res.status).toBe(200)
    const opts = mockJwtVerify.mock.calls[0]![2] as { audience: string[] }
    expect(opts.audience).toEqual([TENANT_CLIENT, MOBILE_CLIENT])
  })

  it('accepts a token issued to the mobile app client (regression: was 401)', async () => {
    mockJwtVerify.mockResolvedValue({ payload: idPayload() })
    const res = await req(buildApp(), 'mobile-tok')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, userId: 'tu-1' })
  })

  it('still returns 401 UNAUTHORIZED when jose rejects the token', async () => {
    mockJwtVerify.mockRejectedValue(new Error('audience mismatch'))
    const res = await req(buildApp(), 'bad')
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHORIZED')
  })

  it('omits an unset mobile client id from the audience (no empty-string aud)', async () => {
    delete process.env['COGNITO_MOBILE_CLIENT_ID']
    mockJwtVerify.mockResolvedValue({ payload: idPayload() })
    await req(buildApp())
    const opts = mockJwtVerify.mock.calls[0]![2] as { audience: string[] }
    expect(opts.audience).toEqual([TENANT_CLIENT])
  })
})
