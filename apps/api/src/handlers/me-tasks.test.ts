// Prisma and the itinerary fetch are mocked, as in longhaul-cloud/itinerary.test.ts:
// these pin the gate, the "no rules ⇒ no legacy read" contract, fail-closed
// fact reads, and snooze/dismiss. The rules themselves are pinned in
// packages/domain/src/tasks.

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

vi.mock('../lib/chat-access', () => ({ legacyConnectionString: vi.fn() }))
vi.mock('../lib/itinerary/fetch', () => ({ fetchItinerary: vi.fn() }))

import { meTasksHandler, TASK_LOOKBACK_DAYS } from './me-tasks'
import { legacyConnectionString } from '../lib/chat-access'
import { fetchItinerary } from '../lib/itinerary/fetch'

const connectionStringMock = legacyConnectionString as unknown as Mock
const fetchMock = fetchItinerary as unknown as Mock
const tenantUserFind = vi.fn()
const tenantFind = vi.fn()
const factFind = vi.fn()
const docFind = vi.fn()
const stateFind = vi.fn()
const stateUpsert = vi.fn()

const TODAY = '2026-11-16'

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    c.set('db', {
      tenant: { findUniqueOrThrow: tenantFind },
      tenantUser: { findUnique: tenantUserFind },
      itineraryActFact: { findMany: factFind },
      document: { findMany: docFind },
      taskState: { findMany: stateFind, upsert: stateUpsert },
    } as unknown as PrismaClient)
    await next()
  })
  app.route('/me/tasks', meTasksHandler)
  return app
}

/** An itinerary item, as lib/itinerary/fetch returns it. */
function item(over: Record<string, unknown> = {}) {
  return {
    key: 'longhaul-activity:1',
    source: { kind: 'longhaul-activity', activityId: 1 },
    orderNum: 500,
    shipperName: 'SMITH',
    actCode: 'PACK',
    actName: 'Pack',
    known: true,
    kind: 'act',
    day: '2026-11-15',
    actual: null,
    assertion: null,
    ...over,
  }
}

function enable(rules: string[]) {
  tenantFind.mockResolvedValue({ appSettings: { operations: { driverTaskRules: rules } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  connectionStringMock.mockResolvedValue('Server=a,1433')
  fetchMock.mockResolvedValue({ items: [item()], failed: [], overCap: [] })
  tenantUserFind.mockResolvedValue({ longhaulDriverId: 1203, localDriverEmployeeId: null })
  enable(['submit-arrival-times', 'submit-bol', 'submit-weight-ticket'])
  factFind.mockResolvedValue([])
  docFind.mockResolvedValue([])
  stateFind.mockResolvedValue([])
  stateUpsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
    taskKey: args.create['taskKey'],
    snoozedUntil: args.create['snoozedUntil'] ?? null,
    dismissedAt: args.create['dismissedAt'] ?? null,
  }))
})

afterEach(() => vi.useRealTimers())

interface ListBody {
  code?: string
  data: Array<{ key: string; rule: string } & Record<string, unknown>>
  meta: Record<string, unknown>
}

async function get(qs = `today=${TODAY}`) {
  const res = await buildApp().request(`/me/tasks?${qs}`)
  return { status: res.status, body: (await res.json()) as ListBody }
}

describe('GET /me/tasks', () => {
  it("evaluates the caller's itinerary over the lookback window", async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('Server=a,1433', {
      from: '2026-11-02',
      to: TODAY,
      longhaulDriverId: 1203,
      localDriverEmployeeId: null,
    })
    expect(TASK_LOOKBACK_DAYS).toBe(14)
    expect(body['data']).toEqual([
      {
        key: 'task:submit-arrival-times:500:longhaul-activity:1',
        rule: 'submit-arrival-times',
        orderNum: 500,
        shipperName: 'SMITH',
        title: 'Mark Pack done',
        due: '2026-11-15',
        bucket: 'overdue',
        target: { kind: 'mark-done', itemKey: 'longhaul-activity:1', day: '2026-11-15' },
      },
    ])
    expect(body['meta']).toMatchObject({ failedSources: [], unavailable: [], hidden: 0 })
  })

  it('makes no legacy read when the tenant enabled no rule', async () => {
    tenantFind.mockResolvedValue({ appSettings: {} })
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body['data']).toEqual([])
    expect(body.meta['enabledRules']).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 403 DRIVER_NOT_MAPPED for a login linked to no driver', async () => {
    tenantUserFind.mockResolvedValue({ longhaulDriverId: null, localDriverEmployeeId: null })
    const { status, body } = await get()
    expect(status).toBe(403)
    expect(body['code']).toBe('DRIVER_NOT_MAPPED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', ''],
    ['not a day', 'today=monday'],
    ['two days off the server', 'today=2026-11-18'],
  ])('rejects a bad `today` (%s) with 400', async (_, qs) => {
    const { status, body } = await get(qs)
    expect(status).toBe(400)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it("accepts a driver's day one either side of the server's", async () => {
    expect((await get('today=2026-11-15')).status).toBe(200)
    expect((await get('today=2026-11-17')).status).toBe(200)
  })

  it('answers 503 when every itinerary source failed', async () => {
    fetchMock.mockResolvedValue({ items: [], failed: ['longhaul', 'order'], overCap: [] })
    const { status, body } = await get()
    expect(status).toBe(503)
    expect(body['code']).toBe('LEGACY_UNAVAILABLE')
  })

  it('reports partial sources, including an over-cap one', async () => {
    fetchMock.mockResolvedValue({ items: [item()], failed: ['order'], overCap: ['longhaul'] })
    const { body } = await get()
    expect(body.meta['failedSources']).toEqual(['order', 'longhaul'])
  })

  it('asks for nothing that depends on act facts it could not read', async () => {
    factFind.mockRejectedValue(new Error('pg down'))
    fetchMock.mockResolvedValue({
      items: [
        item(),
        item({ key: 'k2', actCode: 'RDEL', actName: 'Delivery', actual: '2026-11-14' }),
      ],
      failed: [],
      overCap: [],
    })
    const { status, body } = await get()
    expect(status).toBe(200)
    // The PACK can't be judged; the legacy-delivered RDEL still needs its BOL.
    expect(body.data.map((t) => t.rule)).toEqual(['submit-bol'])
    expect(body.meta['unavailable']).toEqual(['actFacts'])
  })

  it('asks for no document when documents could not be read', async () => {
    docFind.mockRejectedValue(new Error('pg down'))
    fetchMock.mockResolvedValue({
      items: [item({ actCode: 'RDEL', actual: '2026-11-14' })],
      failed: [],
      overCap: [],
    })
    const { body } = await get()
    expect(body['data']).toEqual([])
    expect(body.meta['unavailable']).toEqual(['documents'])
  })

  it('counts only ACTIVE, undeleted shipment documents', async () => {
    fetchMock.mockResolvedValue({
      items: [item({ actCode: 'RDEL', actual: '2026-11-14' })],
      failed: [],
      overCap: [],
    })
    docFind.mockResolvedValue([{ entityId: '500', documentType: 'bol' }])
    const { body } = await get()
    expect(body['data']).toEqual([])
    expect(docFind).toHaveBeenCalledWith({
      where: {
        entityType: 'shipment',
        entityId: { in: ['500'] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { entityId: true, documentType: true },
    })
  })

  it('treats the driver’s DONE fact as done', async () => {
    factFind.mockResolvedValue([
      {
        itemKey: 'longhaul-activity:1',
        basis: 'DONE',
        day: new Date('2026-11-15T00:00:00Z'),
        windowStart: null,
        windowEnd: null,
        assertedById: 'user-1',
        assertedAt: new Date('2026-11-15T20:00:00Z'),
      },
    ])
    expect((await get()).body['data']).toEqual([])
  })

  it('hides dismissed tasks and tasks snoozed into the future, and counts them', async () => {
    fetchMock.mockResolvedValue({
      items: [item({ key: 'a' }), item({ key: 'b' }), item({ key: 'c' })],
      failed: [],
      overCap: [],
    })
    stateFind.mockResolvedValue([
      { taskKey: 'task:submit-arrival-times:500:a', snoozedUntil: null, dismissedAt: new Date() },
      {
        taskKey: 'task:submit-arrival-times:500:b',
        snoozedUntil: new Date(`${TODAY}T18:00:00Z`),
        dismissedAt: null,
      },
      {
        taskKey: 'task:submit-arrival-times:500:c',
        snoozedUntil: new Date(`${TODAY}T09:00:00Z`),
        dismissedAt: null,
      },
    ])
    const { body } = await get()
    expect(body.data.map((t) => t.key)).toEqual(['task:submit-arrival-times:500:c'])
    expect(body.meta['hidden']).toBe(2)
    expect(stateFind.mock.calls[0]?.[0]?.where?.userId).toBe('user-1')
  })
})

describe('PUT /me/tasks/state', () => {
  async function put(body: unknown) {
    const res = await buildApp().request('/me/tasks/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it("snoozes one of the caller's tasks", async () => {
    const key = 'task:submit-bol:500:order'
    const { status, body } = await put({ key, snoozedUntil: '2026-11-17T08:00:00.000Z' })
    expect(status).toBe(200)
    expect(stateUpsert).toHaveBeenCalledWith({
      where: { tenantId_userId_taskKey: { tenantId: 'tenant-1', userId: 'user-1', taskKey: key } },
      create: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        taskKey: key,
        snoozedUntil: new Date('2026-11-17T08:00:00.000Z'),
      },
      update: { snoozedUntil: new Date('2026-11-17T08:00:00.000Z') },
      select: { taskKey: true, snoozedUntil: true, dismissedAt: true },
    })
    expect(body['data']).toEqual({
      key,
      snoozedUntil: '2026-11-17T08:00:00.000Z',
      dismissedAt: null,
    })
  })

  it('dismisses, and un-dismisses', async () => {
    await put({ key: 'task:submit-bol:500:order', dismissed: true })
    expect(stateUpsert.mock.calls[0]?.[0]?.update).toEqual({
      dismissedAt: new Date(`${TODAY}T15:00:00Z`),
    })
    await put({ key: 'task:submit-bol:500:order', dismissed: false })
    expect(stateUpsert.mock.calls[1]?.[0]?.update).toEqual({ dismissedAt: null })
  })

  it.each([
    ['no change named', { key: 'task:submit-bol:500:order' }],
    ['not a task key', { key: 'longhaul-activity:1', dismissed: true }],
    ['not an instant', { key: 'task:submit-bol:500:order', snoozedUntil: 'tomorrow' }],
  ])('rejects %s with 400', async (_, body) => {
    const res = await put(body)
    expect(res.status).toBe(400)
    expect(stateUpsert).not.toHaveBeenCalled()
  })
})
