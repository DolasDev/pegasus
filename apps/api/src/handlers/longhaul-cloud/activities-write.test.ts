// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct activity-save handler.
// resolveLonghaulUser, executeSql, and recomputeTripSummaryCloud are mocked.
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

import { longhaulSaveActivityHandler } from './activities-write'
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
  app.post('/onprem/longhaul/activities/:id', longhaulSaveActivityHandler)
  return app
}

function save(id: string, body: unknown) {
  return buildApp().request(`/onprem/longhaul/activities/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
  recomputeMock.mockResolvedValue(1)
  // Default: SELECT TripMaster_id returns trip 100; UPDATE returns rowsAffected.
  executeSqlMock
    .mockResolvedValueOnce({
      recordset: [{ TripMaster_id: 100 }],
      recordsets: [[]],
      rowsAffected: [],
    })
    .mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [1] })
})

describe('POST /activities/:id (cloud-direct save)', () => {
  it('updates only provided columns + audit, then recomputes the trip summary', async () => {
    const res = await save('5', { actual_date: '2026-06-01', city: 'Reno' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })

    const [, updSql, updOpts] = executeSqlMock.mock.calls[1]!
    expect(updSql).toContain('UPDATE LongDistanceDispatchActivity SET')
    expect(updSql).toContain('actual_date = @actual_date')
    expect(updSql).toContain('city = @city')
    expect(updSql).toContain('modified_by = @modified_by')
    expect(updSql).not.toContain('estimated_date = @estimated_date')
    expect(updOpts.params).toContainEqual({ name: 'modified_by', value: 7 })
    expect(updOpts.params).toContainEqual({ name: 'id', value: 5 })

    // In-place update (no TripMaster_id change) → one recompute for trip 100.
    expect(recomputeMock).toHaveBeenCalledTimes(1)
    expect(recomputeMock).toHaveBeenCalledWith('Server=a,1433', 100)
  })

  it('recomputes BOTH trips when the activity moves between trips', async () => {
    const res = await save('5', { TripMaster_id: 200 })
    expect(res.status).toBe(200)
    expect(recomputeMock).toHaveBeenCalledTimes(2)
    expect(recomputeMock).toHaveBeenCalledWith('Server=a,1433', 200) // next
    expect(recomputeMock).toHaveBeenCalledWith('Server=a,1433', 100) // previous
  })

  it('returns 404 when the activity does not exist', async () => {
    // Reset the beforeEach queue (clearAllMocks would keep the queued Onces).
    executeSqlMock.mockReset()
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [] })
    const res = await save('5', { city: 'Reno' })
    expect(res.status).toBe(404)
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric id with 400', async () => {
    executeSqlMock.mockReset()
    const res = await save('x', { city: 'Reno' })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('propagates the auth error from resolveLonghaulUser', async () => {
    executeSqlMock.mockReset()
    resolveMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'no',
      code: 'LONGHAUL_USER_NOT_FOUND',
    })
    const res = await save('5', { city: 'Reno' })
    expect(res.status).toBe(403)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })
})
