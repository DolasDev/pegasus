// ---------------------------------------------------------------------------
// Unit tests for the /api/v1/me handler.
//
// Runs against the offline (wasm) authz backend so no AVP is involved. The
// shape returned by GET /permissions is the public contract — keep this test
// in step with the SPA's permission gate consumers when adding actions.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
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
        Actions.ReadIntegrationConfig.permission,
        Actions.ReadIntegrationProjection.permission,
        Actions.RateShipment.permission,
        Actions.ReadTariff.permission,
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

describe('GET /driver', () => {
  const mockFindUnique = vi.fn()

  function buildDriverApp(userId: string | undefined) {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', userId as string)
      c.set('db', {
        tenantUser: { findUnique: mockFindUnique },
      } as unknown as PrismaClient)
      await next()
    })
    app.route('/', meHandler)
    return app
  }

  beforeEach(() => mockFindUnique.mockReset())

  it('returns the mapped longhaul driver id for the calling user', async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: 4231 })
    const res = await buildDriverApp('user-1').request('/driver')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { longhaulDriverId: 4231 } })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { longhaulDriverId: true },
    })
  })

  it('returns null when the user has no driver mapping', async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: null })
    const res = await buildDriverApp('user-1').request('/driver')
    expect(await res.json()).toEqual({ data: { longhaulDriverId: null } })
  })

  it('returns null without a DB lookup for an unresolved user (M2M / service account)', async () => {
    const res = await buildDriverApp(undefined).request('/driver')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { longhaulDriverId: null } })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
