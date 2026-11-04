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

import {
  myItineraryHandler,
  myItineraryEtaHandler,
  myItineraryDoneHandler,
  driverItineraryHandler,
} from './itinerary'
import { legacyConnectionString } from '../../lib/chat-access'
import { fetchItinerary } from '../../lib/itinerary/fetch'

const connectionStringMock = legacyConnectionString as unknown as Mock
const fetchMock = fetchItinerary as unknown as Mock
const tenantUserFind = vi.fn()
const factCreate = vi.fn()
const factFind = vi.fn()

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
    c.set('db', {
      tenantUser: { findUnique: tenantUserFind },
      itineraryActFact: { create: factCreate, findMany: factFind },
    } as unknown as PrismaClient)
    await next()
  })
  app.get('/onprem/longhaul/me/itinerary', myItineraryHandler)
  app.get('/onprem/longhaul/drivers/itinerary', driverItineraryHandler)
  app.put('/onprem/longhaul/me/itinerary/acts/eta', myItineraryEtaHandler)
  app.put('/onprem/longhaul/me/itinerary/acts/done', myItineraryDoneHandler)
  return app
}

const ITEM = { key: 'longhaul-activity:1', day: '2026-10-21' }

beforeEach(() => {
  vi.clearAllMocks()
  connectionStringMock.mockResolvedValue('Server=a,1433')
  fetchMock.mockResolvedValue({ items: [ITEM], failed: [], overCap: [] })
  tenantUserFind.mockResolvedValue({ longhaulDriverId: 1203, localDriverEmployeeId: 412 })
  factCreate.mockResolvedValue({})
  factFind.mockResolvedValue([])
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
      // No fact recorded for it: the item carries `assertion: null`.
      data: [{ ...ITEM, assertion: null }],
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
    fetchMock.mockResolvedValue({ items: [], failed: ['longhaul', 'order', 'local'], overCap: [] })
    const { status, body } = await get(
      '/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25',
    )
    expect(status).toBe(503)
    expect(body['code']).toBe('LEGACY_UNAVAILABLE')
  })

  it('counts a longhaul id as two sources: 503 only when both fail', async () => {
    tenantUserFind.mockResolvedValue({ longhaulDriverId: 1203, localDriverEmployeeId: null })
    fetchMock.mockResolvedValue({ items: [ITEM], failed: ['order'], overCap: [] })
    const partial = await get('/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25')
    expect(partial.status).toBe(200)

    fetchMock.mockResolvedValue({ items: [], failed: ['longhaul', 'order'], overCap: [] })
    const down = await get('/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25')
    expect(down.status).toBe(503)
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

describe("reads attach the driver's own assertions", () => {
  it('attaches the newest fact to its item, leaving the legacy day alone', async () => {
    factFind.mockResolvedValue([
      {
        itemKey: 'longhaul-activity:1',
        basis: 'DONE',
        day: new Date('2026-10-21T00:00:00Z'),
        windowStart: null,
        windowEnd: null,
        assertedById: 'user-1',
        assertedAt: new Date('2026-10-21T15:00:00Z'),
      },
    ])
    const { body } = await get('/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25')
    expect((body['data'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      day: '2026-10-21',
      assertion: { done: '2026-10-21', eta: null, byUserId: 'user-1' },
    })
    expect(factFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemKey: { in: ['longhaul-activity:1'] } } }),
    )
  })

  it('still answers when the facts cannot be read', async () => {
    factFind.mockRejectedValue(new Error('pg down'))
    const { status } = await get('/onprem/longhaul/me/itinerary?from=2026-10-19&to=2026-10-25')
    expect(status).toBe(200)
  })
})

describe('PUT /me/itinerary/acts/eta and /acts/done', () => {
  const LOCAL = {
    key: 'local-job-token:7001:PACK',
    source: { kind: 'local-job-token', jobId: 7001, token: 'PACK' },
    orderNum: 493175,
    actCode: 'PACK',
    day: '2026-11-03',
  }
  const ACTIVITY = {
    key: 'longhaul-activity:9001',
    source: { kind: 'longhaul-activity', activityId: 9001 },
    orderNum: 491615,
    actCode: 'LOAD',
    day: '2026-11-03',
  }

  async function put(which: 'eta' | 'done', body: unknown) {
    const res = await buildApp().request(`/onprem/longhaul/me/itinerary/acts/${which}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  beforeEach(() => {
    fetchMock.mockResolvedValue({ items: [LOCAL, ACTIVITY], failed: [], overCap: [] })
  })

  it("records an ETA on the caller's own local act, after re-reading that day", async () => {
    const { status, body } = await put('eta', {
      key: LOCAL.key,
      day: '2026-11-03',
      eta: { day: '2026-11-04', window: { start: '08:00', end: '10:00' } },
    })
    expect(status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('Server=a,1433', {
      from: '2026-11-03',
      to: '2026-11-03',
      longhaulDriverId: 1203,
      localDriverEmployeeId: 412,
    })
    expect(factCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        itemKey: LOCAL.key,
        sourceKind: 'local-job-token',
        orderNum: 493175,
        basis: 'ETA',
        day: new Date('2026-11-04T00:00:00.000Z'),
        windowStart: '08:00',
        windowEnd: '10:00',
        assertedById: 'user-1',
        capturedBy: 'driver-app',
      }),
    })
    expect(body['data']).toMatchObject({ key: LOCAL.key })
  })

  it("records done on any of the caller's acts — a trip activity too — and clears with null", async () => {
    const first = await put('done', { key: ACTIVITY.key, day: '2026-11-03', done: '2026-11-03' })
    expect(first.status).toBe(200)
    expect(factCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ itemKey: ACTIVITY.key, basis: 'DONE' }),
    })
    const cleared = await put('done', { key: LOCAL.key, day: '2026-11-03', done: null })
    expect(cleared.status).toBe(200)
    expect(factCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ itemKey: LOCAL.key, basis: 'DONE', day: null }),
    })
  })

  it("refuses an act that is not on the caller's own itinerary that day, recording nothing", async () => {
    const { status, body } = await put('done', {
      key: 'order-assigned:999999:RDEL',
      day: '2026-11-03',
      done: '2026-11-03',
    })
    expect(status).toBe(404)
    expect(body['code']).toBe('NOT_FOUND')
    expect(factCreate).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when a source could not be read to check ownership', async () => {
    fetchMock.mockResolvedValue({ items: [], failed: ['local'], overCap: [] })
    const { status } = await put('done', { key: LOCAL.key, day: '2026-11-03', done: '2026-11-03' })
    expect(status).toBe(503)
    expect(factCreate).not.toHaveBeenCalled()
  })

  it("sends a trip activity's ETA to its existing editor instead of storing a second one", async () => {
    const { status, body } = await put('eta', {
      key: ACTIVITY.key,
      day: '2026-11-03',
      eta: { day: '2026-11-04' },
    })
    expect(status).toBe(409)
    expect(body['code']).toBe('USE_ACTIVITY_ETA')
    expect(factCreate).not.toHaveBeenCalled()
  })

  it('answers 403 DRIVER_NOT_MAPPED for an unlinked login, without a legacy read', async () => {
    tenantUserFind.mockResolvedValue({ longhaulDriverId: null, localDriverEmployeeId: null })
    const { status, body } = await put('done', {
      key: LOCAL.key,
      day: '2026-11-03',
      done: '2026-11-03',
    })
    expect(status).toBe(403)
    expect(body['code']).toBe('DRIVER_NOT_MAPPED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['no key', { day: '2026-11-03', done: '2026-11-03' }],
    ['a bad day', { key: 'local-job-token:7001:PACK', day: '2026-02-30', done: '2026-11-03' }],
    ['a bad done day', { key: 'local-job-token:7001:PACK', day: '2026-11-03', done: 'tomorrow' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { status } = await put('done', body)
    expect(status).toBe(400)
    expect(factCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['a window ending before it starts', { start: '10:00', end: '08:00' }],
    ['a window that is not HH:mm', { start: '8am', end: '10:00' }],
  ])('rejects %s', async (_label, window) => {
    const { status } = await put('eta', {
      key: LOCAL.key,
      day: '2026-11-03',
      eta: { day: '2026-11-04', window },
    })
    expect(status).toBe(400)
  })
})
