// ---------------------------------------------------------------------------
// Unit tests for tenantMiddleware
//
// The real middleware is imported directly — this file deliberately does NOT
// mock ./middleware/tenant. The database and createTenantDb are mocked so no
// Postgres connection is required. jose is mocked so JWT verification can be
// controlled without real tokens or JWKS endpoints.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errors } from 'jose'
import type * as JoseModule from 'jose'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Hoist the jwtVerify mock above all imports
// ---------------------------------------------------------------------------

const { mockJwtVerify } = vi.hoisted(() => ({ mockJwtVerify: vi.fn() }))

// ---------------------------------------------------------------------------
// Mock jose — preserve real exports (including errors.JWTExpired) but
// override createRemoteJWKSet and jwtVerify for test control.
// ---------------------------------------------------------------------------

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof JoseModule>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})

// ---------------------------------------------------------------------------
// Mock the Prisma base client and the tenant-scoped extension factory
// ---------------------------------------------------------------------------

vi.mock('../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    tenantUser: { findFirst: vi.fn() },
  },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})), // returns a no-op db object
}))

import { db } from '../db'
import { tenantMiddleware } from '../middleware/tenant'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', tenantMiddleware)
  app.get('/probe', (c) =>
    c.json({ tenantId: c.get('tenantId'), role: c.get('role'), userId: c.get('userId') }),
  )
  return app
}

type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED'

function mockTenant(status: TenantStatus) {
  vi.mocked(db.tenant.findUnique).mockResolvedValue({
    id: 'tenant-uuid',
    name: 'Acme Moving',
    slug: 'acme',
    status,
    plan: 'STARTER',
    contactName: null,
    contactEmail: null,
    ssoProviderConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
}

/** Returns RequestInit with an Authorization: Bearer header. */
function bearerRequest(opts: RequestInit = {}): RequestInit {
  return { ...opts, headers: { Authorization: 'Bearer mock-token', ...opts.headers } }
}

/** Configures mockJwtVerify to resolve with valid tenant claims. */
function mockValidToken(tenantId = 'tenant-uuid', role = 'tenant_user', sub = 'cognito-sub-xyz') {
  mockJwtVerify.mockResolvedValueOnce({
    payload: { token_use: 'id', 'custom:tenantId': tenantId, 'custom:role': role, sub },
  })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env['COGNITO_JWKS_URL'] =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test/.well-known/jwks.json'
  process.env['COGNITO_TENANT_CLIENT_ID'] = 'tenant-client-id'
  mockJwtVerify.mockReset()
  vi.mocked(db.tenant.findUnique).mockReset()
  vi.mocked(db.tenantUser.findFirst).mockResolvedValue(null)
})

afterEach(() => {
  delete process.env['COGNITO_JWKS_URL']
  delete process.env['COGNITO_TENANT_CLIENT_ID']
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenantMiddleware', () => {
  // ── Authorization header checks ────────────────────────────────────────────

  it('returns 401 UNAUTHORIZED when Authorization header is absent', async () => {
    const res = await buildApp().request('/probe')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  it('returns 401 UNAUTHORIZED when Authorization header is not Bearer scheme', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  it('returns 401 UNAUTHORIZED when JWT fails verification (invalid signature)', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('signature verification failed'))

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  it('returns 401 TOKEN_EXPIRED when JWT is expired', async () => {
    const expired = new errors.JWTExpired('token expired', {})
    mockJwtVerify.mockRejectedValueOnce(expired)

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TOKEN_EXPIRED')
  })

  it('returns 401 UNAUTHORIZED when token_use claim is not "id" (access token used)', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        token_use: 'access',
        'custom:tenantId': 'tenant-uuid',
        'custom:role': 'tenant_user',
      },
    })

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('UNAUTHORIZED')
  })

  // ── Missing claims ─────────────────────────────────────────────────────────

  it('returns 403 FORBIDDEN when custom:tenantId claim is absent', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { token_use: 'id', 'custom:role': 'tenant_user' },
    })

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when custom:role claim is absent', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { token_use: 'id', 'custom:tenantId': 'tenant-uuid' },
    })

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('FORBIDDEN')
  })

  // ── Tenant DB lookup ───────────────────────────────────────────────────────

  it('returns 404 TENANT_NOT_FOUND when no tenant matches the tenantId claim', async () => {
    mockValidToken()
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_NOT_FOUND')
  })

  // ── Tenant status enforcement ─────────────────────────────────────────────

  it('passes request through and sets tenantId + role for ACTIVE tenant', async () => {
    mockValidToken('tenant-uuid', 'tenant_admin')
    mockTenant('ACTIVE')

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['tenantId']).toBe('tenant-uuid')
    expect(body['role']).toBe('tenant_admin')
  })

  it('returns 403 TENANT_SUSPENDED for SUSPENDED tenant', async () => {
    mockValidToken()
    mockTenant('SUSPENDED')

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_SUSPENDED')
  })

  it('returns 404 TENANT_NOT_FOUND for OFFBOARDED tenant (indistinguishable from unknown)', async () => {
    mockValidToken()
    mockTenant('OFFBOARDED')

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_NOT_FOUND')
  })

  it('does not expose OFFBOARDED status in the response body for OFFBOARDED tenant', async () => {
    mockValidToken()
    mockTenant('OFFBOARDED')

    const res = await buildApp().request('/probe', bearerRequest())
    const text = await res.text()
    expect(text).not.toContain('OFFBOARDED')
    expect(text).not.toContain('offboard')
  })

  // ── userId resolution ──────────────────────────────────────────────────────

  it('sets userId when TenantUser is found by cognitoSub', async () => {
    mockValidToken('tenant-uuid', 'tenant_user', 'cognito-sub-abc')
    mockTenant('ACTIVE')
    vi.mocked(db.tenantUser.findFirst).mockResolvedValue({ id: 'tenant-user-uuid' } as never)

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['userId']).toBe('tenant-user-uuid')
  })

  it('does not set userId when TenantUser is not found (fail-open)', async () => {
    mockValidToken('tenant-uuid', 'tenant_user', 'cognito-sub-unknown')
    mockTenant('ACTIVE')
    vi.mocked(db.tenantUser.findFirst).mockResolvedValue(null)

    const res = await buildApp().request('/probe', bearerRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // userId should be undefined/absent, not set
    expect(body['userId']).toBeUndefined()
  })
})
