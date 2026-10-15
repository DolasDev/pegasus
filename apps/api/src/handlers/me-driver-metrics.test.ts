// GET /driver/metrics — scoping, partial failure, and SQL parameterization.
// The mssql executor and the pegII gateway are faked at the module seam.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { PegiiApiError } from '../lib/pegii-api-error'

const { executeSql, resolveDriverGateway, getFinancials, resolvePegiiCaller } = vi.hoisted(() => ({
  executeSql: vi.fn(),
  resolveDriverGateway: vi.fn(),
  getFinancials: vi.fn(),
  resolvePegiiCaller: vi.fn(),
}))

vi.mock('../lib/mssql-executor-client', () => ({ executeSql }))
vi.mock('../gateways/driver-gateway.factory', () => ({ resolveDriverGateway }))
vi.mock('../lib/pegii-request-context', () => ({ resolvePegiiCaller }))

import { meHandler } from './me'

const FINANCIALS = {
  runningBalance: 1234.56,
  escrowHeld: 800,
  monthEnd: { year: 2026, month: 9, balance: 1100 },
  pendingSettlement: { total: 2500, count: 2 },
}

function buildApp(
  opts: {
    userId?: string | null
    driverId?: number | null
    mssqlConnectionString?: string | null
  } = {},
) {
  const userId = opts.userId === undefined ? 'user-1' : opts.userId
  const driverId = opts.driverId === undefined ? 4766 : opts.driverId
  const tenantUserFindUnique = vi.fn().mockResolvedValue({ longhaulDriverId: driverId })
  const tenantFindUnique = vi.fn().mockResolvedValue({
    mssqlConnectionString:
      opts.mssqlConnectionString === undefined ? 'Server=legacy;' : opts.mssqlConnectionString,
  })
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    if (userId) c.set('userId', userId)
    c.set('db', {
      tenantUser: { findUnique: tenantUserFindUnique },
      tenant: { findUnique: tenantFindUnique },
    } as unknown as PrismaClient)
    await next()
  })
  app.route('/', meHandler)
  return { app, tenantUserFindUnique }
}

type Body = {
  data: {
    driverId: number
    asOf: string
    weekStart: string
    trips: { activeShipments: number; completedThisWeek: number } | null
    financials: typeof FINANCIALS | null
    unavailable: Array<{ section: string; reason: string }>
  }
  code?: string
}

beforeEach(() => {
  vi.clearAllMocks()
  executeSql.mockResolvedValue({ recordset: [{ activeShipments: 2, completedThisWeek: 1 }] })
  getFinancials.mockResolvedValue(FINANCIALS)
  resolveDriverGateway.mockResolvedValue({ getFinancials })
})

describe('GET /driver/metrics', () => {
  it('404 DRIVER_NOT_LINKED when the user has no longhaulDriverId', async () => {
    const res = await buildApp({ driverId: null }).app.request('/driver/metrics')
    expect(res.status).toBe(404)
    expect(((await res.json()) as Body).code).toBe('DRIVER_NOT_LINKED')
    expect(executeSql).not.toHaveBeenCalled()
    expect(resolveDriverGateway).not.toHaveBeenCalled()
  })

  it('404 DRIVER_NOT_LINKED when there is no userId (service principal)', async () => {
    const { app, tenantUserFindUnique } = buildApp({ userId: null })
    const res = await app.request('/driver/metrics')
    expect(res.status).toBe(404)
    expect(((await res.json()) as Body).code).toBe('DRIVER_NOT_LINKED')
    expect(tenantUserFindUnique).not.toHaveBeenCalled()
  })

  it('happy path: trips + financials, nothing unavailable', async () => {
    const res = await buildApp().app.request('/driver/metrics')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(data.driverId).toBe(4766)
    expect(data.trips).toEqual({ activeShipments: 2, completedThisWeek: 1 })
    expect(data.financials).toEqual(FINANCIALS)
    expect(data.unavailable).toEqual([])
    expect(Number.isNaN(Date.parse(data.asOf))).toBe(false)
    expect(Number.isNaN(Date.parse(data.weekStart))).toBe(false)
    expect(Date.parse(data.weekStart)).toBeLessThanOrEqual(Date.parse(data.asOf))
    expect(getFinancials).toHaveBeenCalledWith(4766)
  })

  it("hands the gateway factory a resolver for the request's own pegII caller", async () => {
    const caller = { tenantId: 'tenant-1', correlationId: 'corr-1' }
    resolvePegiiCaller.mockResolvedValue(caller)
    let resolved: unknown
    resolveDriverGateway.mockImplementation(
      async (_db: unknown, tenantId: string, callerOf: () => Promise<unknown>) => {
        expect(tenantId).toBe('tenant-1')
        resolved = await callerOf()
        return { getFinancials }
      },
    )

    const res = await buildApp().app.request('/driver/metrics')

    expect(res.status).toBe(200)
    expect(resolvePegiiCaller).toHaveBeenCalledTimes(1)
    expect(resolved).toBe(caller)
  })

  it('takes the driver id from the DB row, never the query string, and binds it as a parameter', async () => {
    const { app, tenantUserFindUnique } = buildApp({ driverId: 4766 })
    await app.request('/driver/metrics?driverId=999&driver_id=999')

    expect(tenantUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { longhaulDriverId: true },
    })
    const [conn, sql, opts] = executeSql.mock.calls[0] as [
      string,
      string,
      { params: Array<{ name: string; value: unknown }> },
    ]
    expect(conn).toBe('Server=legacy;')
    expect(sql).not.toContain('4766')
    expect(sql).not.toContain('999')
    expect(sql).toContain('@driverId')
    expect(opts.params.find((p) => p.name === 'driverId')?.value).toBe(4766)
    const weekStart = opts.params.find((p) => p.name === 'weekStart')?.value
    expect(weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(getFinancials).toHaveBeenCalledWith(4766)
  })

  it('pegII capability missing -> financials null + reason, trips still served (200)', async () => {
    getFinancials.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'site does not support it'),
    )
    const res = await buildApp().app.request('/driver/metrics')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(data.financials).toBeNull()
    expect(data.trips).toEqual({ activeShipments: 2, completedThisWeek: 1 })
    expect(data.unavailable).toEqual([
      { section: 'financials', reason: 'PEGII_API_CAPABILITY_MISSING' },
    ])
  })

  it('tenant with no pegII target (factory throws NOT_CONFIGURED) -> financials null', async () => {
    resolveDriverGateway.mockRejectedValue(
      new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'no target'),
    )
    const { data } = (await (await buildApp().app.request('/driver/metrics')).json()) as Body
    expect(data.financials).toBeNull()
    expect(data.unavailable).toEqual([
      { section: 'financials', reason: 'PEGII_API_NOT_CONFIGURED' },
    ])
  })

  it('mssql failure -> trips null + the error code, financials still served (200)', async () => {
    executeSql.mockRejectedValue(
      Object.assign(new Error('executor blew up'), { code: 'EXECUTOR_QUERY_ERROR' }),
    )
    const res = await buildApp().app.request('/driver/metrics')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(data.trips).toBeNull()
    expect(data.financials).toEqual(FINANCIALS)
    expect(data.unavailable).toEqual([{ section: 'trips', reason: 'EXECUTOR_QUERY_ERROR' }])
  })

  it('no mssqlConnectionString -> trips null with NOT_CONFIGURED, without calling the executor', async () => {
    const { data } = (await (
      await buildApp({ mssqlConnectionString: null }).app.request('/driver/metrics')
    ).json()) as Body
    expect(data.trips).toBeNull()
    expect(data.unavailable).toEqual([{ section: 'trips', reason: 'NOT_CONFIGURED' }])
    expect(executeSql).not.toHaveBeenCalled()
  })

  it('an error without a string code reports UNAVAILABLE; both sections can fail together', async () => {
    executeSql.mockRejectedValue(new Error('boom'))
    getFinancials.mockRejectedValue('weird')
    const res = await buildApp().app.request('/driver/metrics')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(data.trips).toBeNull()
    expect(data.financials).toBeNull()
    expect(data.unavailable).toEqual(
      expect.arrayContaining([
        { section: 'trips', reason: 'UNAVAILABLE' },
        { section: 'financials', reason: 'UNAVAILABLE' },
      ]),
    )
  })
})
