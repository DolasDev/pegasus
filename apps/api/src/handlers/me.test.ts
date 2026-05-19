// ---------------------------------------------------------------------------
// Unit tests for the /api/v1/me handler.
//
// Runs against the offline (wasm) authz backend so no AVP is involved. The
// shape returned by GET /permissions is the public contract — keep this test
// in step with the SPA's permission gate consumers when adding actions.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { meHandler } from './me'
import { ALL_ACTIONS, Actions } from '../authz/actions'
import { _clearAuthzCache } from '../lib/authz'
import { seedPrincipal } from '../__tests__/_principal'

function buildApp(roleNames: string[]) {
  const app = new Hono<AppEnv>()
  app.use('*', seedPrincipal({ roleNames }))
  app.route('/', meHandler)
  return app
}

beforeEach(() => {
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
})

describe('GET /permissions', () => {
  it('returns the full action catalog for tenant_admin', async () => {
    const res = await buildApp(['tenant_admin']).request('/permissions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }
    expect(body.roles).toEqual(['tenant_admin'])
    expect(new Set(body.permissions)).toEqual(new Set(ALL_ACTIONS.map((a) => a.permission)))
  })

  it('returns only read permissions for tenant_user', async () => {
    const res = await buildApp(['viewer']).request('/permissions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }
    expect(body.roles).toEqual(['viewer'])
    expect(new Set(body.permissions)).toEqual(
      new Set([
        Actions.ReadQuote.permission,
        Actions.ListMoves.permission,
        Actions.ReadMove.permission,
        Actions.ReadInvoice.permission,
        Actions.ReadCustomer.permission,
        Actions.ReadWorkflow.permission,
      ]),
    )
  })

  it('returns an empty permissions array for an empty-roles principal', async () => {
    const res = await buildApp([]).request('/permissions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }
    expect(body.roles).toEqual([])
    expect(body.permissions).toEqual([])
  })
})
