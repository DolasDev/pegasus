// ---------------------------------------------------------------------------
// Regression (sdk-feedback 0044 Part C): an authenticated API-key caller on a
// `/api/v1/pegii/*` route that does not exist must get a 404, not a 401.
//
// app.ts mounts m2mV1 and v1 on the same `/api/v1` prefix. A `vnd_` request
// that matches no m2mV1 route falls through to v1, whose tenant middleware only
// knows Cognito sessions. It answered `401 "Invalid or unverifiable token"` to a
// key that had just authenticated on the m2m side, so "this route does not
// exist" and "your credentials are bad" were indistinguishable. Establishing
// that a pegII order-write route was missing took a known-good route and an
// invented one as controls.
//
// Drives the REAL app. Only dual-auth is mocked, as a stand-in for a verified
// `vnd_` key; the tenant middleware stays real, because it is what used to
// answer.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('../middleware/dual-auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dualAuthMiddleware: vi.fn(async (c: any, next: () => Promise<void>) => {
    if (c.req.header('Authorization') !== 'Bearer vnd_valid') {
      return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
    }
    c.set('tenantId', 'test-tenant-id')
    c.set('principal', {
      sub: 'svc',
      tenantId: 'test-tenant-id',
      roleNames: ['workflow_runtime'],
    })
    c.set('db', {})
    c.set('userId', 'svc-user-1')
    await next()
  }),
}))

import { app } from '../app'

const valid = { Authorization: 'Bearer vnd_valid' }

describe('unmatched /api/v1/pegii/* routes', () => {
  it.each([
    ['POST', '/api/v1/pegii/orders/zzz/close'],
    ['PATCH', '/api/v1/pegii/orders/490317'],
    ['POST', '/api/v1/pegii/tasks/create'],
    ['GET', '/api/v1/pegii/no-such-thing'],
  ])('answers 404 NOT_FOUND to an authenticated key: %s %s', async (method, path) => {
    const res = await app.request(path, { method, headers: valid })

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('leaves a real route alone: the catch-all is terminal, not a shadow', async () => {
    const res = await app.request('/api/v1/pegii/tasks?orderId=490317', { headers: valid })

    expect(res.status).toBe(200)
  })

  it('still answers 401 to a bad key on an invented route', async () => {
    // The route's existence must not be confirmed to an unauthenticated caller
    // any differently than before: auth runs first.
    const res = await app.request('/api/v1/pegii/orders/zzz/close', {
      method: 'POST',
      headers: { Authorization: 'Bearer vnd_wrong' },
    })

    expect(res.status).toBe(401)
  })
})
