// ---------------------------------------------------------------------------
// Unit tests for the longhaul activities handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { Knex } from 'knex'
import type { PrismaClient } from '@prisma/client'

const mockDb = {} as unknown as Knex

vi.mock('../../repositories/longhaul/activities.repository', () => ({
  saveActivity: vi.fn(),
  insertActivity: vi.fn(),
  findActivityById: vi.fn(),
}))

vi.mock('../../repositories/longhaul/trips.repository', () => ({
  updateTripSummaryInfo: vi.fn(),
}))

import {
  saveActivity,
  insertActivity,
  findActivityById,
} from '../../repositories/longhaul/activities.repository'
import { updateTripSummaryInfo } from '../../repositories/longhaul/trips.repository'
import { activitiesRouter } from './activities'

const MOCK_USER = {
  code: 42,
  first_name: 'Test',
  last_name: 'User',
  active: 'Y',
  win_username: 'testuser',
}

function buildApp() {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', MOCK_USER)
    c.set('longhaulDb', mockDb)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', activitiesRouter)
  return app
}

beforeEach(() => {
  vi.mocked(saveActivity).mockReset()
  vi.mocked(insertActivity).mockReset()
  vi.mocked(findActivityById).mockReset()
  vi.mocked(updateTripSummaryInfo).mockReset()
})

// ---------------------------------------------------------------------------
// POST /activities/:id  (update)
// ---------------------------------------------------------------------------

describe('POST /activities/:id', () => {
  it('returns 200 on successful activity save', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    vi.mocked(findActivityById).mockResolvedValue({ id: 10, TripMaster_id: null })
    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_date: '2026-04-01', status: 'Completed' }),
    })
    expect(res.status).toBe(200)
    expect(saveActivity).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.objectContaining({ actual_date: '2026-04-01' }),
      MOCK_USER.code,
    )
  })

  it('returns 400 for non-numeric activity id', async () => {
    const app = buildApp()
    const res = await app.request('/activities/not-a-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Completed' }),
    })
    expect(res.status).toBe(400)
  })

  it('recomputes trip summary when activity has a TripMaster_id', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    vi.mocked(findActivityById).mockResolvedValue({ id: 10, TripMaster_id: 77 })
    vi.mocked(updateTripSummaryInfo).mockResolvedValue(1)

    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_date: '2026-04-01' }),
    })

    expect(res.status).toBe(200)
    expect(updateTripSummaryInfo).toHaveBeenCalledTimes(1)
    expect(updateTripSummaryInfo).toHaveBeenCalledWith(expect.anything(), 77)
  })

  it('recomputes both trips when TripMaster_id changes', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    vi.mocked(findActivityById).mockResolvedValue({ id: 10, TripMaster_id: 77 })
    vi.mocked(updateTripSummaryInfo).mockResolvedValue(1)

    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TripMaster_id: 88 }),
    })

    expect(res.status).toBe(200)
    expect(updateTripSummaryInfo).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(updateTripSummaryInfo).mock.calls.map((c) => c[1])
    expect(calls).toEqual(expect.arrayContaining([77, 88]))
  })

  it('does NOT recompute when activity is not on any trip and TripMaster_id is not set', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    vi.mocked(findActivityById).mockResolvedValue({ id: 10, TripMaster_id: null })

    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Pending' }),
    })

    expect(res.status).toBe(200)
    expect(updateTripSummaryInfo).not.toHaveBeenCalled()
  })

  it('recomputes only the old trip when TripMaster_id is cleared to null', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    vi.mocked(findActivityById).mockResolvedValue({ id: 10, TripMaster_id: 77 })
    vi.mocked(updateTripSummaryInfo).mockResolvedValue(1)

    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TripMaster_id: null }),
    })

    expect(res.status).toBe(200)
    expect(updateTripSummaryInfo).toHaveBeenCalledTimes(1)
    expect(updateTripSummaryInfo).toHaveBeenCalledWith(expect.anything(), 77)
  })
})

// ---------------------------------------------------------------------------
// POST /activities  (create)
// ---------------------------------------------------------------------------

describe('POST /activities', () => {
  it('creates an activity and recomputes the trip summary when TripMaster_id is set', async () => {
    vi.mocked(insertActivity).mockResolvedValue(123)
    vi.mocked(updateTripSummaryInfo).mockResolvedValue(1)

    const app = buildApp()
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_num: 5001,
        ActivityType_code: 'LOAD',
        TripMaster_id: 77,
      }),
    })

    expect(res.status).toBe(201)
    expect(insertActivity).toHaveBeenCalledTimes(1)
    expect(updateTripSummaryInfo).toHaveBeenCalledWith(expect.anything(), 77)
  })

  it('does NOT recompute trip summary when TripMaster_id is null', async () => {
    vi.mocked(insertActivity).mockResolvedValue(124)

    const app = buildApp()
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_num: 5001,
        ActivityType_code: 'LOAD',
      }),
    })

    expect(res.status).toBe(201)
    expect(updateTripSummaryInfo).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const app = buildApp()
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Pending' }),
    })
    expect(res.status).toBe(400)
  })
})
