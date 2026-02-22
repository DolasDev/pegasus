// ---------------------------------------------------------------------------
// Unit tests for adminAuthMiddleware
//
// jose is fully mocked so tests run without any network access or real JWTs.
// The middleware's JWKS cache (_jwks) is lazily initialised on first call and
// reused across tests — this is intentional and matches Lambda warm behaviour.
// jwtVerify is re-configured per test via vi.mocked().mockResolvedValue /
// mockRejectedValue, which is sufficient because jwtVerify controls all
// outcomes regardless of what the JWKS set object contains.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../types'

// vi.mock is hoisted before all imports by Vitest's transform. The factory
// runs once; both the middleware module and this file share the same mock.
vi.mock('jose', () => {
  // Construct JWTExpired inside the factory so instanceof checks in the
  // middleware reference the same constructor as the tests use.
  class JWTExpired extends Error {
    readonly code = 'ERR_JWT_EXPIRED'
    // Match jose v5's JWTClaimValidationFailed signature:
    //   (message: string, payload: JWTPayload, claim?: string, reason?: string)
    constructor(message: string, _payload?: unknown, _claim?: string, _reason?: string) {
      super(message)
      this.name = 'JWTExpired'
    }
  }

  return {
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
    errors: { JWTExpired },
  }
})

// Static imports — resolved after vi.mock is applied.
import { jwtVerify, errors } from 'jose'
import { adminAuthMiddleware } from '../middleware/admin-auth'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

/** Builds a minimal Hono app with the middleware applied for inspection. */
function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', adminAuthMiddleware)
  app.get('/probe', (c) =>
    c.json({ sub: c.get('adminSub'), email: c.get('adminEmail') }),
  )
  return app
}

function bearerRequest(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adminAuthMiddleware', () => {
  beforeEach(() => {
    vi.mocked(jwtVerify).mockReset()
    process.env['COGNITO_JWKS_URL'] =
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test/.well-known/jwks.json'
  })

  // ── 401 cases ─────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is absent', async () => {
    const res = await buildApp().request('/probe')
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when Authorization is not a Bearer scheme', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 with TOKEN_EXPIRED code when the JWT is expired', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(
      new errors.JWTExpired('jwt expired', {}),
    )

    const res = await buildApp().request('/probe', bearerRequest('expired.jwt.token'))
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('TOKEN_EXPIRED')
  })

  it('returns 401 when the JWT signature is invalid', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('invalid signature'))

    const res = await buildApp().request('/probe', bearerRequest('bad.jwt.token'))
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when the JWT is missing the sub claim', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        // sub intentionally omitted
        token_use: 'access',
        email: 'admin@example.com',
        'cognito:groups': ['PLATFORM_ADMIN'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('no.sub.token'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when token_use is "id" instead of "access"', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'admin-sub',
        token_use: 'id', // ID token must be rejected; only access tokens are valid here
        email: 'admin@pegasus.com',
        'cognito:groups': ['PLATFORM_ADMIN'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('id.token.here'))
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when token_use claim is absent', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'admin-sub',
        // token_use intentionally absent
        'cognito:groups': ['PLATFORM_ADMIN'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('no.token-use.token'))
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('UNAUTHORIZED')
  })

  // ── 403 cases ─────────────────────────────────────────────────────────────

  it('returns 403 when JWT is valid but user is in TENANT_USER group only', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'tenant-user-sub',
        token_use: 'access',
        email: 'user@tenant.com',
        'cognito:groups': ['TENANT_USER'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('tenant.jwt.token'))
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  it('returns 403 when JWT is valid but has no groups claim at all', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: 'some-sub', token_use: 'access', email: 'user@example.com' },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('no.groups.token'))
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
  })

  // ── 200 — happy path ──────────────────────────────────────────────────────

  it('passes and sets adminSub + adminEmail for a valid PLATFORM_ADMIN JWT', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'admin-sub-abc123',
        token_use: 'access',
        email: 'admin@pegasus.com',
        'cognito:groups': ['PLATFORM_ADMIN'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('valid.admin.token'))
    expect(res.status).toBe(200)

    const body = await json(res)
    expect(body['sub']).toBe('admin-sub-abc123')
    expect(body['email']).toBe('admin@pegasus.com')
  })

  it('passes when the user is in multiple groups including PLATFORM_ADMIN', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'multi-group-sub',
        token_use: 'access',
        email: 'superadmin@pegasus.com',
        'cognito:groups': ['TENANT_USER', 'PLATFORM_ADMIN', 'ANOTHER_GROUP'],
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('multi.group.token'))
    expect(res.status).toBe(200)
    expect((await json(res))['sub']).toBe('multi-group-sub')
  })

  it('uses empty string for adminEmail when email claim is absent', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: 'no-email-sub',
        token_use: 'access',
        'cognito:groups': ['PLATFORM_ADMIN'],
        // email is absent in access tokens; middleware falls back to empty string
      },
    } as never)

    const res = await buildApp().request('/probe', bearerRequest('no.email.token'))
    expect(res.status).toBe(200)
    expect((await json(res))['email']).toBe('')
  })
})
