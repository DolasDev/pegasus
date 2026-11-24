// ---------------------------------------------------------------------------
// Unit tests for the /api/v1/me handler.
//
// Runs against the offline (wasm) authz backend so no AVP is involved. The
// shape returned by GET /permissions is the public contract — keep this test
// in step with the SPA's permission gate consumers when adding actions.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { meHandler } from './me'
import { ALL_ACTIONS, Actions } from '../authz/actions'
import { _clearAuthzCache } from '../lib/authz'
import { seedPrincipal } from '../__tests__/_principal'

// `/permissions` now reads the tenant's `mssqlConnectionString` to derive the
// `longhaul` capability, so the harness seeds a tenant-scoped `db`. Default:
// no connection string (longhaul:false). Pass a value to exercise longhaul:true.
function buildApp(roleNames: string[], mssqlConnectionString: string | null = null) {
  const tenantFindUnique = vi.fn().mockResolvedValue({ mssqlConnectionString })
  const app = new Hono<AppEnv>()
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', { tenant: { findUnique: tenantFindUnique } } as unknown as PrismaClient)
    await next()
  })
  app.route('/', meHandler)
  return { app, tenantFindUnique }
}

beforeEach(() => {
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
})

describe('GET /permissions', () => {
  it('returns the full action catalog for tenant_admin', async () => {
    const res = await buildApp(['tenant_admin']).app.request('/permissions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }
    expect(body.roles).toEqual(['tenant_admin'])
    expect(new Set(body.permissions)).toEqual(new Set(ALL_ACTIONS.map((a) => a.permission)))
  })

  it("returns the caller's own TenantUser id, and null without one", async () => {
    const withUser = new Hono<AppEnv>()
    withUser.use('*', seedPrincipal({ roleNames: ['viewer'] }))
    withUser.use('*', async (c, next) => {
      c.set('userId', 'user-123')
      await next()
    })
    withUser.route('/', meHandler)
    const res = await withUser.request('/permissions')
    expect(((await res.json()) as { userId: unknown }).userId).toBe('user-123')

    const anon = await buildApp(['viewer']).app.request('/permissions')
    expect(((await anon.json()) as { userId: unknown }).userId).toBeNull()
  })

  it('returns the viewer read set plus the shared document baseline', async () => {
    const res = await buildApp(['viewer']).app.request('/permissions')
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
        Actions.ReadFeedbackForms.permission,
        Actions.RateShipment.permission,
        Actions.ReadTariff.permission,
        Actions.ReadReportingDataset.permission,
        // Document read/upload, move chat and labor are granted to every authenticated user.
        Actions.ReadDocument.permission,
        Actions.UploadDocument.permission,
        Actions.ReadChat.permission,
        Actions.PostChat.permission,
        Actions.ReadLabor.permission,
        Actions.WriteLabor.permission,
        Actions.ReadSupport.permission,
        Actions.PostSupport.permission,
      ]),
    )
  })

  it('returns only the shared baseline for an empty-roles principal', async () => {
    const res = await buildApp([]).app.request('/permissions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; permissions: string[] }
    expect(body.roles).toEqual([])
    expect(new Set(body.permissions)).toEqual(
      new Set([
        Actions.ReadDocument.permission,
        Actions.UploadDocument.permission,
        Actions.ReadChat.permission,
        Actions.PostChat.permission,
        Actions.ReadLabor.permission,
        Actions.WriteLabor.permission,
        Actions.ReadSupport.permission,
        Actions.PostSupport.permission,
      ]),
    )
  })

  describe('capabilities.support', () => {
    afterEach(() => {
      delete process.env['SUPPORT_ENABLED']
    })

    it('follows SUPPORT_ENABLED, since support:read is granted either way', async () => {
      process.env['SUPPORT_ENABLED'] = 'true'
      const res = await buildApp(['sales'], null).app.request('/permissions')
      const body = (await res.json()) as { capabilities: { support: boolean } }
      expect(body.capabilities.support).toBe(true)
    })
  })

  describe('capabilities.longhaul', () => {
    it('is true when the tenant has a mssqlConnectionString', async () => {
      const { app, tenantFindUnique } = buildApp(['tenant_admin'], 'Server=legacy;Database=lh;')
      const res = await app.request('/permissions')
      const body = (await res.json()) as { capabilities: { longhaul: boolean } }
      expect(body.capabilities).toEqual({
        longhaul: true,
        reporting: false,
        assistant: false,
        support: false,
      })
      expect(tenantFindUnique).toHaveBeenCalledWith({
        where: { id: 'test-tenant-id' },
        select: { mssqlConnectionString: true },
      })
    })

    it('is false when the tenant has no mssqlConnectionString', async () => {
      const res = await buildApp(['tenant_admin'], null).app.request('/permissions')
      const body = (await res.json()) as { capabilities: { longhaul: boolean } }
      expect(body.capabilities).toEqual({
        longhaul: false,
        reporting: false,
        assistant: false,
        support: false,
      })
    })

    it('is false (no throw) for a principal with no tenant-scoped db', async () => {
      // M2M / service-account principals resolve no `db` in context.
      const app = new Hono<AppEnv>()
      app.use('*', seedPrincipal({ roleNames: ['tenant_admin'] }))
      app.route('/', meHandler)
      const res = await app.request('/permissions')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { capabilities: { longhaul: boolean } }
      expect(body.capabilities).toEqual({
        longhaul: false,
        reporting: false,
        assistant: false,
        support: false,
      })
    })
  })
})

describe('GET /driver', () => {
  const mockFindUnique = vi.fn()
  const mockTenantFind = vi.fn()

  function buildDriverApp(userId: string | undefined) {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', userId as string)
      c.set('tenantId', 'tenant-1')
      c.set('db', {
        tenant: { findUniqueOrThrow: mockTenantFind },
        tenantUser: { findUnique: mockFindUnique },
      } as unknown as PrismaClient)
      await next()
    })
    app.route('/', meHandler)
    return app
  }

  beforeEach(() => {
    mockFindUnique.mockReset()
    mockTenantFind.mockReset()
    mockTenantFind.mockResolvedValue({ appSettings: {} })
  })

  it('returns the mapped longhaul driver id for the calling user', async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: 4231, localDriverEmployeeId: 3097 })
    const res = await buildDriverApp('user-1').request('/driver')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        longhaulDriverId: 4231,
        localDriverEmployeeId: 3097,
        userId: 'user-1',
        driverEtaEnabled: false,
      },
    })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { longhaulDriverId: true, localDriverEmployeeId: true },
    })
  })

  it('returns null when the user has no driver mapping', async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: null, localDriverEmployeeId: null })
    const res = await buildDriverApp('user-1').request('/driver')
    expect(await res.json()).toEqual({
      data: {
        longhaulDriverId: null,
        localDriverEmployeeId: null,
        userId: 'user-1',
        driverEtaEnabled: false,
      },
    })
  })

  it('still returns the mapping, with ETAs off, when the settings read fails', async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: 4231, localDriverEmployeeId: null })
    mockTenantFind.mockRejectedValue(new Error('db blip'))
    const res = await buildDriverApp('user-1').request('/driver')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({ longhaulDriverId: 4231, driverEtaEnabled: false })
  })

  it("carries the tenant's driver ETA opt-in", async () => {
    mockFindUnique.mockResolvedValue({ longhaulDriverId: 4231, localDriverEmployeeId: null })
    mockTenantFind.mockResolvedValue({ appSettings: { operations: { driverEtaSubmission: true } } })
    const res = await buildDriverApp('user-1').request('/driver')
    const body = (await res.json()) as { data: { driverEtaEnabled: boolean } }
    expect(body.data.driverEtaEnabled).toBe(true)
    expect(mockTenantFind).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { appSettings: true },
    })
  })

  it('returns null without a DB lookup for an unresolved user (M2M / service account)', async () => {
    const res = await buildDriverApp(undefined).request('/driver')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        longhaulDriverId: null,
        localDriverEmployeeId: null,
        userId: null,
        driverEtaEnabled: false,
      },
    })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
