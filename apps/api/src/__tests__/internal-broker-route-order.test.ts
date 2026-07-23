// ---------------------------------------------------------------------------
// Regression: the worker-only /internal broker routes must NOT be shadowed by
// a dual-auth/tenant middleware.
//
// Incident (2026-07): PR #447 mounted a root-'/' handler
// (integrationProjectionReadHandler, `.use('*', dualAuthMiddleware)`) ONE line
// above the `/internal` mount on m2mV1. In Hono a root-'/' wildcard registered
// before a sibling route runs first, so `dualAuthMiddleware` intercepted
// `GET /internal/tenant-workflows` and rejected the worker's broker-token
// request with a generic "Missing or malformed Authorization header" 401
// (code UNAUTHORIZED) — the request never reached requireBrokerAuth. Result:
// every per-tenant workflow runner failed startup auth and crash-looped for a
// week, stranding tenant-lane workflows at WorkflowTaskScheduled.
//
// These tests drive the REAL m2mV1 router (the same wiring app.ts serves) so a
// re-introduced ordering regression fails here. They must NOT mock the auth
// middleware — the whole point is that the broker routes are reached BEFORE any
// dual-auth/tenant wildcard. A malformed broker token is rejected by
// requireBrokerAuth without any DB access (parse fails before the credential
// lookup), so no Prisma/KMS is needed.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { m2mV1 } from '../app'

const INTERNAL_PATHS = [
  '/internal/tenant-workflows',
  '/internal/workflow-runtime-token',
  '/internal/workflow-executions/00000000-0000-0000-0000-000000000000',
]

describe('m2mV1 /internal broker routes are not shadowed by dual-auth', () => {
  it('a broker-token request reaches requireBrokerAuth (INVALID_BROKER_TOKEN), not the tenant/dual-auth guard', async () => {
    // Exactly what the tenant runner sends: an X-Workflow-Broker-Token header
    // and NO Authorization header. A malformed token is rejected by
    // requireBrokerAuth (parse fails → no DB) — the point is WHICH guard replies.
    const res = await m2mV1.request(
      '/internal/tenant-workflows?tenantId=00000000-0000-0000-0000-000000000000',
      {
        method: 'GET',
        headers: { 'X-Workflow-Broker-Token': 'wbk_not-a-real-token' },
      },
    )

    expect(res.status).toBe(401)
    const body = (await res.json()) as { code?: string; error?: string }
    // The broker-auth guard was reached...
    expect(body.code).toBe('INVALID_BROKER_TOKEN')
    // ...and specifically NOT the dual-auth/tenant guard that shadowed it in the
    // #447 regression.
    expect(body.code).not.toBe('UNAUTHORIZED')
    expect(body.error).not.toBe('Missing or malformed Authorization header')
  })

  it('a request with no auth headers is rejected by requireBrokerAuth (INVALID_BROKER_SECRET), proving reachability', async () => {
    const res = await m2mV1.request(
      '/internal/tenant-workflows?tenantId=00000000-0000-0000-0000-000000000000',
      {
        method: 'GET',
      },
    )

    expect(res.status).toBe(401)
    const body = (await res.json()) as { code?: string; error?: string }
    expect(body.code).toBe('INVALID_BROKER_SECRET')
    expect(body.error).not.toBe('Missing or malformed Authorization header')
  })

  it('every /internal route is registered before any root-mounted dual-auth catch-all', () => {
    // Structural backstop to the behavioral tests above: assert the internal
    // routes appear ahead of the first root-'/' mount in Hono's registration
    // order, so a future re-order is caught even if the behavioral fixtures drift.
    const routes = (m2mV1 as unknown as { routes: Array<{ path: string }> }).routes
    const firstInternalIdx = routes.findIndex((r) => r.path.startsWith('/internal'))
    // The projection-read handler (and the other outbound handlers) are mounted
    // at root '/', so their wildcard middleware registers on path '/*'.
    const firstRootWildcardIdx = routes.findIndex((r) => r.path === '/*' || r.path === '*')

    expect(firstInternalIdx).toBeGreaterThanOrEqual(0)
    if (firstRootWildcardIdx !== -1) {
      expect(firstInternalIdx).toBeLessThan(firstRootWildcardIdx)
    }
  })

  it('all internal broker paths resolve to the broker-auth guard', async () => {
    for (const path of INTERNAL_PATHS) {
      const res = await m2mV1.request(path, { method: 'GET' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      // None may be answered by the tenant/dual-auth "Authorization header" guard.
      expect(body.error).not.toBe('Missing or malformed Authorization header')
    }
  })
})
