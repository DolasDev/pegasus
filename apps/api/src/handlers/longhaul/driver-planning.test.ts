// ---------------------------------------------------------------------------
// Unit tests for the longhaul driver-planning handler.
// Repository layer is mocked — no MSSQL connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Knex } from 'knex'
import type { ConnectionPool } from 'mssql'
import type { PrismaClient } from '@prisma/client'
import type { OnPremEnv } from '../../types.onprem'

const mockDb = {} as unknown as Knex

vi.mock('../../repositories/longhaul/driver-planning.repository', () => ({
  getDriverPlanning: vi.fn(),
  upsertConfirmedAvailability: vi.fn(),
}))

import {
  getDriverPlanning,
  upsertConfirmedAvailability,
  type DriverPlanningRow,
} from '../../repositories/longhaul/driver-planning.repository'
import { driverPlanningRouter } from './driver-planning'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const MOCK_USER = {
  code: 99,
  first_name: 'Disp',
  last_name: 'Atcher',
  active: 'Y',
  win_username: 'dispatcher',
}

function buildApp(opts: { user?: typeof MOCK_USER | undefined } = {}) {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', 'user' in opts ? opts.user : MOCK_USER)
    c.set('longhaulDb', mockDb)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    c.set('correlationId', 'cid-test')
    await next()
  })
  app.route('/', driverPlanningRouter)
  return app
}

// ---------------------------------------------------------------------------
// GET /driver-planning
// ---------------------------------------------------------------------------

describe('GET /driver-planning', () => {
  beforeEach(() => {
    vi.mocked(getDriverPlanning).mockReset()
    vi.mocked(upsertConfirmedAvailability).mockReset()
  })

  it('returns the rows from the repository with a count meta', async () => {
    vi.mocked(getDriverPlanning).mockResolvedValue([
      { driverId: 1 } as unknown as DriverPlanningRow,
      { driverId: 2 } as unknown as DriverPlanningRow,
    ])
    const res = await buildApp().request('/driver-planning')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual([{ driverId: 1 }, { driverId: 2 }])
    expect(body['meta']).toEqual({ count: 2 })
    expect(getDriverPlanning).toHaveBeenCalledWith(mockDb)
  })

  it('returns an empty list and count=0 when no drivers', async () => {
    vi.mocked(getDriverPlanning).mockResolvedValue([])
    const res = await buildApp().request('/driver-planning')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual([])
    expect(body['meta']).toEqual({ count: 0 })
  })

  it('returns 500 with correlationId when the repository throws', async () => {
    vi.mocked(getDriverPlanning).mockRejectedValue(new Error('connection lost'))
    const res = await buildApp().request('/driver-planning')
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body['code']).toBe('INTERNAL_ERROR')
    expect(body['correlationId']).toBe('cid-test')
  })
})

// ---------------------------------------------------------------------------
// PATCH /driver-planning/:driverId
// ---------------------------------------------------------------------------

describe('PATCH /driver-planning/:driverId', () => {
  beforeEach(() => {
    vi.mocked(upsertConfirmedAvailability).mockReset()
    vi.mocked(upsertConfirmedAvailability).mockResolvedValue(undefined as unknown as void)
  })

  it('forwards body + user.code to upsertConfirmedAvailability and returns success', async () => {
    const body = {
      confirmedDate: '2026-06-01',
      confirmedLocation: 'Chicago, IL',
      notes: 'first leg',
    }
    const res = await buildApp().request('/driver-planning/42', patch(body))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: { success: true } })
    expect(upsertConfirmedAvailability).toHaveBeenCalledWith(
      mockDb,
      42,
      {
        confirmedDate: '2026-06-01',
        confirmedLocation: 'Chicago, IL',
        notes: 'first leg',
      },
      99, // MOCK_USER.code
    )
  })

  it('defaults notes to null when omitted', async () => {
    const res = await buildApp().request(
      '/driver-planning/7',
      patch({ confirmedDate: '2026-07-04', confirmedLocation: 'Denver, CO' }),
    )
    expect(res.status).toBe(200)
    expect(upsertConfirmedAvailability).toHaveBeenCalledWith(
      mockDb,
      7,
      expect.objectContaining({ notes: null }),
      99,
    )
  })

  it('passes user.code as null when no longhaulUser is set', async () => {
    const res = await buildApp({ user: undefined }).request(
      '/driver-planning/7',
      patch({ confirmedDate: null, confirmedLocation: null }),
    )
    expect(res.status).toBe(200)
    expect(upsertConfirmedAvailability).toHaveBeenCalledWith(mockDb, 7, expect.any(Object), null)
  })

  it('returns 400 when driverId is not numeric', async () => {
    const res = await buildApp().request(
      '/driver-planning/not-a-number',
      patch({ confirmedDate: '2026-06-01', confirmedLocation: 'Chicago, IL' }),
    )
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(upsertConfirmedAvailability).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is missing required fields', async () => {
    const res = await buildApp().request('/driver-planning/42', patch({}))
    expect(res.status).toBe(400)
    expect(upsertConfirmedAvailability).not.toHaveBeenCalled()
  })

  it('returns 500 with correlationId when the repository throws', async () => {
    vi.mocked(upsertConfirmedAvailability).mockRejectedValue(new Error('deadlock'))
    const res = await buildApp().request(
      '/driver-planning/42',
      patch({ confirmedDate: '2026-06-01', confirmedLocation: 'Chicago, IL' }),
    )
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body['code']).toBe('INTERNAL_ERROR')
    expect(body['correlationId']).toBe('cid-test')
  })
})
