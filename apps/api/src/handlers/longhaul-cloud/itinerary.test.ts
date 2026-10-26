// Prisma and the itinerary fetch are mocked: these tests pin who may read
// whose itinerary, the query contract, and how fetch outcomes become statuses.
// The SQL itself is pinned in lib/itinerary/fetch.test.ts.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../lib/chat-access', () => ({ legacyConnectionString: vi.fn() }))
vi.mock('../../lib/itinerary/fetch', () => ({ fetchItinerary: vi.fn() }))

import { myItineraryHandler, driverItineraryHandler } from './itinerary'
import { legacyConnectionString } from '../../lib/chat-access'
import { fetchItinerary } from '../../lib/itinerary/fetch'

const connectionStringMock = legacyConnectionString as unknown as Mock
const fetchMock = fetchItinerary as unknown as Mock
const tenantUserFind = vi.fn()

function buildApp(roleNames: string[] = ['driver']) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    c.set('principal', {
      sub: 's',
      tenantId: 'tenant-1',
      roleNames,
    } as AppEnv['Variables']['principal'])
    c.set('db', { tenantUser: { findUnique: tenantUserFind } } as unknown as PrismaClient)
    await next()
  })
  app.get('/onprem/longhaul/me/itinerary', myItineraryHandler)
  app.get('/onprem/longhaul/drivers/itinerary', driverItineraryHandler)
  return app
}

const ITEM = { key: 'longhaul-activity:1', day: '2026-10-21' }

beforeEach(() => {
  vi.clearAllMocks()
  connectionStringMock.mockResolvedValue('Server=a,1433')
  fetchMock.mockResolvedValue({ items: [ITEM], failed: [], overCap: [] })
  tenantUserFind.mockResolvedValue({ longhaulDriverId: 1203, localDriverEmployeeId: 412 })
})

async function get(path: string, roles?: string[]) {
  const res = await buildApp(roles).request(path)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('GET /me/itinerary', () => {
  it("reads the caller's own work through both of their mapped ids", async () => {
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('Server=a,1433', {
      from: '2026-10-19',
      to: '2026-10-25',
      longhaulDriverId: 1203,
      localDriverEmployeeId: 412,
    })
    expect(body).toEqual({
      data: [ITEM],
      meta: { count: 1, from: '2026-10-19', to: '2026-10-25', failedSources: [] },
    })
  })

  it('reads one source when only one id is mapped, treating 0 as unmapped', async () => {
    tenantUserFind.mockResolvedValue({ longhaulDriverId: 0, localDriverEmployeeId: 412 })
    await get('/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      longhaulDriverId: null,
      localDriverEmployeeId: 412,
    })
  })

  it('answers 403 DRIVER_NOT_MAPPED for a login linked to no driver, without a legacy read', async () => {
    tenantUserFind.mockResolvedValue({ longhaulDriverId: null, localDriverEmployeeId: null })
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(403)
    expect(body['code']).toBe('DRIVER_NOT_MAPPED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing to', 'from=2026-10-19'],
    ['not a day', 'from=2026-10-19&to=tomorrow'],
    ['February 30th', 'from=2026-02-28&to=2026-02-30'],
    ['backwards', 'from=2026-10-25&to=2026-10-19'],
    ['longer than 31 days', 'from=2026-10-01&to=2026-11-01'],
  ])('rejects a bad range (%s) with 400', async (_, qs) => {
    const { status, body } = await get(`/onprem/longhaul/me/itinerary?${qs}`)
    expect(status).toBe(400)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('accepts exactly 31 days', async () => {
    const { status } = await get('/onprem/longhaul/me/itinerary?from=2026-10-01&to=2026-10-31')
    expect(status).toBe(200)
  })

  it('answers 422 when the tenant has no legacy database', async () => {
    connectionStringMock.mockResolvedValue(null)
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(422)
    expect(body['code']).toBe('MSSQL_NOT_CONFIGURED')
  })

  it('still answers 200 when one source failed, and says which', async () => {
    fetchMock.mockResolvedValue({ items: [ITEM], failed: ['local'], overCap: [] })
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(200)
    expect(body['meta']).toMatchObject({ failedSources: ['local'] })
  })

  it('answers 503 when every source it asked for failed', async () => {
    fetchMock.mockResolvedValue({ items: [], failed: ['longhaul', 'local'], overCap: [] })
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(503)
    expect(body['code']).toBe('LEGACY_UNAVAILABLE')
  })

  it('answers 400 rather than a truncated list when a source hit the cap', async () => {
    fetchMock.mockResolvedValue({ items: [ITEM], failed: [], overCap: ['longhaul'] })
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(400)
    expect(body['code']).toBe('RESULT_LIMIT_EXCEEDED')
  })
})

describe('GET /drivers/itinerary', () => {
  const OPS = ['long_distance_dispatch']

  it('is refused to a non-Operations login, even one with a driver mapping', async () => {
    const { status } = await get(
      '/onprem/longhaul/drivers/itinerary?from=2026-10-19&to=2026-10-25&longhaulDriverId=77',
    )
    expect(status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the named driver for a dispatcher, never the dispatcher’s own mapping', async () => {
    const { status } = await get(
      '/onprem/longhaul/drivers/itinerary?from=2026-10-19&to=2026-10-25&localDriverEmployeeId=88',
      OPS,
    )
    expect(status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
      longhaulDriverId: null,
      localDriverEmployeeId: 88,
    })
    expect(tenantUserFind).not.toHaveBeenCalled()
  })

  it('needs at least one driver id', async () => {
    const { status } = await get(
      '/onprem/longhaul/drivers/itinerary?from=2026-10-19&to=2026-10-25',
      OPS,
    )
    expect(status).toBe(400)
  })

  it('rejects a non-integer id', async () => {
    const { status } = await get(
      '/onprem/longhaul/drivers/itinerary?from=2026-10-19&to=2026-10-25&longhaulDriverId=1%20OR%201%3D1',
      OPS,
    )
    expect(status).toBe(400)
  })
})
