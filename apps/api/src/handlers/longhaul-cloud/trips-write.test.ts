// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct trip-write handlers (status / cancel / summary).
// resolveLonghaulUser and executeSql are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-user', () => ({ resolveLonghaulUser: vi.fn() }))
vi.mock('../../lib/longhaul-cloud-trip-summary', () => ({ recomputeTripSummaryCloud: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import {
  longhaulTripStatusHandler,
  longhaulTripCancelHandler,
  longhaulTripSummaryHandler,
} from './trips-write'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { executeSql } from '../../lib/mssql-executor-client'
import { recomputeTripSummaryCloud } from '../../lib/longhaul-cloud-trip-summary'

const resolveMock = resolveLonghaulUser as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock
const recomputeMock = recomputeTripSummaryCloud as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    await next()
  })
  app.patch('/onprem/longhaul/trips/:id/status', longhaulTripStatusHandler)
  app.post('/onprem/longhaul/trips/:id/cancel', longhaulTripCancelHandler)
  app.patch('/onprem/longhaul/trips/:id/summary', longhaulTripSummaryHandler)
  return app
}

function req(path: string, method: string, body?: unknown) {
  return buildApp().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// recordsets helper: [header, activities, statusRow]
function readResult(
  header: unknown[] | null,
  activities: unknown[] = [],
  statusRow: unknown[] = [{ status: 'In Transit' }],
) {
  return {
    recordset: header ?? [],
    recordsets: [header ?? [], activities, statusRow],
    rowsAffected: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
})

describe('PATCH /trips/:id/status (cloud-direct)', () => {
  it('changes status + syncs activities in a transaction, returns the re-read trip', async () => {
    executeSqlMock
      .mockResolvedValueOnce(
        readResult([{ driver_id: 9, TripStatus_id: 2 }], [{ actual_date: '2026-06-01' }]),
      )
      .mockResolvedValueOnce({
        recordset: [{ id: 55, TripStatus_id: 3 }],
        recordsets: [],
        rowsAffected: [1, 2],
      })

    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 3 })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 55, TripStatus_id: 3 } })
    const [, writeSql, opts] = executeSqlMock.mock.calls[1]!
    expect(writeSql).toContain('BEGIN TRAN')
    expect(writeSql).toContain('UPDATE TripMaster SET TripStatus_id = @statusId')
    expect(writeSql).toContain('UPDATE LongDistanceDispatchActivity')
    expect(opts.params).toContainEqual({ name: 'statusName', value: 'In Transit' })
    expect(opts.params).toContainEqual({ name: 'code', value: 7 })
  })

  // Confirming a driver onto a trip clears their stale ready availability.
  it('clears ready availability on Offered -> Accepted for an assigned driver', async () => {
    executeSqlMock
      .mockResolvedValueOnce(readResult([{ driver_id: 9, TripStatus_id: 2 }]))
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [], rowsAffected: [1] })

    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 3 })

    expect(res.status).toBe(200)
    const [, writeSql, opts] = executeSqlMock.mock.calls[1]!
    expect(writeSql).toContain('UPDATE DriverConfirmedAvailability')
    expect(opts.params).toContainEqual({ name: 'clearReady', value: 1 })
    expect(opts.params).toContainEqual({ name: 'driverId', value: 9 })
  })

  it('clears ready availability on a direct Pending -> Accepted jump', async () => {
    executeSqlMock
      .mockResolvedValueOnce(readResult([{ driver_id: 9, TripStatus_id: 1 }]))
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [], rowsAffected: [1] })

    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 3 })

    expect(res.status).toBe(200)
    expect(executeSqlMock.mock.calls[1]![2].params).toContainEqual({
      name: 'clearReady',
      value: 1,
    })
  })

  it('does NOT clear when the driver is already confirmed (Accepted -> In-Progress)', async () => {
    executeSqlMock
      .mockResolvedValueOnce(readResult([{ driver_id: 9, TripStatus_id: 3 }]))
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [], rowsAffected: [1] })

    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 4 })

    expect(res.status).toBe(200)
    expect(executeSqlMock.mock.calls[1]![2].params).toContainEqual({
      name: 'clearReady',
      value: 0,
    })
  })

  it('does NOT clear on Pending -> Offered (still not confirmed)', async () => {
    executeSqlMock
      .mockResolvedValueOnce(readResult([{ driver_id: 9, TripStatus_id: 1 }]))
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [], rowsAffected: [1] })

    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 2 })

    expect(res.status).toBe(200)
    expect(executeSqlMock.mock.calls[1]![2].params).toContainEqual({
      name: 'clearReady',
      value: 0,
    })
  })

  it('returns 404 when the trip is missing', async () => {
    executeSqlMock.mockResolvedValueOnce(readResult(null))
    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 3 })
    expect(res.status).toBe(404)
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // no write
  })

  it('blocks advancing past pending without a driver (403)', async () => {
    executeSqlMock.mockResolvedValueOnce(readResult([{ driver_id: null, TripStatus_id: 1 }], []))
    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 3 })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toContain('without an assigned driver')
  })

  it('blocks finalizing (>=5) while an activity lacks an actual_date (403)', async () => {
    executeSqlMock.mockResolvedValueOnce(
      readResult(
        [{ driver_id: 9, TripStatus_id: 4 }],
        [{ actual_date: '2026-06-01' }, { actual_date: null }],
      ),
    )
    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 5 })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toContain('actual dates')
  })

  it('allows finalizing when all activities have actual dates', async () => {
    executeSqlMock
      .mockResolvedValueOnce(
        readResult([{ driver_id: 9, TripStatus_id: 4 }], [{ actual_date: '2026-06-01' }]),
      )
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [], rowsAffected: [1, 1] })
    const res = await req('/onprem/longhaul/trips/55/status', 'PATCH', { statusId: 5 })
    expect(res.status).toBe(200)
  })
})

describe('POST /trips/:id/cancel (cloud-direct)', () => {
  it('cancels a pre-in-progress trip atomically', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [{ TripStatus_id: 2 }],
        recordsets: [],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], recordsets: [], rowsAffected: [1, 1, 1] })

    const res = await req('/onprem/longhaul/trips/55/cancel', 'POST')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    const [, cancelSql, opts] = executeSqlMock.mock.calls[1]!
    expect(cancelSql).toContain('DELETE FROM LongDistanceDispatchActivity')
    expect(cancelSql).toContain("internal_status = 'canceled'")
    expect(opts.params).toContainEqual({ name: 'code', value: 7 })
  })

  it('returns 404 when the trip is missing', async () => {
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [], rowsAffected: [] })
    const res = await req('/onprem/longhaul/trips/55/cancel', 'POST')
    expect(res.status).toBe(404)
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('blocks canceling at/after in-progress status (>=4) with 403', async () => {
    executeSqlMock.mockResolvedValueOnce({
      recordset: [{ TripStatus_id: 4 }],
      recordsets: [],
      rowsAffected: [],
    })
    const res = await req('/onprem/longhaul/trips/55/cancel', 'POST')
    expect(res.status).toBe(403)
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // no destructive write
  })
})

describe('PATCH /trips/:id/summary (cloud-direct recompute)', () => {
  it('recomputes the trip summary (ignoring the body) and returns success', async () => {
    recomputeMock.mockResolvedValue(1)
    const res = await req('/onprem/longhaul/trips/55/summary', 'PATCH', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    expect(recomputeMock).toHaveBeenCalledWith('Server=a,1433', 55)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-numeric trip id', async () => {
    const res = await req('/onprem/longhaul/trips/x/summary', 'PATCH', {})
    expect(res.status).toBe(400)
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the recompute fails', async () => {
    recomputeMock.mockRejectedValue(new Error('boom'))
    const res = await req('/onprem/longhaul/trips/55/summary', 'PATCH', {})
    expect(res.status).toBe(500)
  })
})
