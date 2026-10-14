// ---------------------------------------------------------------------------
// Unit tests for the driver-scoped ETA write (mobile driver app).
// The request-scoped Prisma client (tenant + tenantUser), executeSql and recomputeTripSummaryCloud are
// mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-trip-summary', () => ({ recomputeTripSummaryCloud: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import { driverActivityEtaHandler } from './driver-activity-eta'
import { executeSql } from '../../lib/mssql-executor-client'
import { recomputeTripSummaryCloud } from '../../lib/longhaul-cloud-trip-summary'
import { resetArrivalWindowProvisioningCache } from '../../lib/longhaul-arrival-window-schema'

const tenantFindMock = vi.fn()
const executeSqlMock = executeSql as unknown as Mock
const recomputeMock = recomputeTripSummaryCloud as unknown as Mock
const tenantUserFindMock = vi.fn()

const DRIVER_ID = 42

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    TripMaster_id: 100,
    assigned_driver_id: DRIVER_ID,
    trip_driver_id: DRIVER_ID,
    ActivityType_code: 'RDEL',
    isHasETA: true,
    ...overrides,
  }
}

const rs = (rows: unknown[]) => ({ recordset: rows, recordsets: [rows], rowsAffected: [] })

/** Route every executeSql call by statement so tests don't depend on ordering. */
function routeSql(activity: Record<string, unknown> | null) {
  executeSqlMock.mockImplementation(async (_cs: string, sql: string) => {
    if (sql.includes('LEFT JOIN TripMaster')) return rs(activity ? [activity] : [])
    if (sql.startsWith('UPDATE LongDistanceDispatchActivity'))
      return { ...rs([]), rowsAffected: [1] }
    if (sql.includes('SELECT a.*'))
      return rs([{ id: 5, estimated_date: '2026-11-02', is_committed: true }])
    // Arrival-window provisioning probes / ALTERs.
    return rs([])
  })
}

function buildApp(userId: string | undefined = 'user-1') {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    if (userId) c.set('userId', userId)
    c.set('db', {
      tenant: { findUnique: tenantFindMock },
      tenantUser: { findUnique: tenantUserFindMock },
    } as unknown as PrismaClient)
    await next()
  })
  app.patch('/onprem/longhaul/driver/activities/:id/eta', driverActivityEtaHandler)
  return app
}

function patch(id: string, body: unknown, userId?: string) {
  return buildApp(userId).request(`/onprem/longhaul/driver/activities/${id}/eta`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function updateCall() {
  return executeSqlMock.mock.calls.find(([, sql]) =>
    String(sql).startsWith('UPDATE LongDistanceDispatchActivity'),
  )
}

const WINDOW = {
  arrival_window_start: '08:00',
  arrival_window_end: '10:00',
  arrival_window_tz: 'America/Chicago',
}

beforeEach(() => {
  vi.clearAllMocks()
  executeSqlMock.mockReset()
  resetArrivalWindowProvisioningCache()
  tenantFindMock.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
  tenantUserFindMock.mockResolvedValue({ longhaulDriverId: DRIVER_ID })
  recomputeMock.mockResolvedValue(1)
  routeSql(activityRow())
})

describe('PATCH /driver/activities/:id/eta', () => {
  it('writes ETA + window + is_committed, never is_confirmed, then recomputes the trip', async () => {
    const res = await patch('5', { estimated_date: '2026-11-02', ...WINDOW, committed: true })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({ id: 5, is_committed: true })

    const [, sql, opts] = updateCall()!
    expect(sql).toContain('estimated_date = @estimated_date')
    expect(sql).toContain('arrival_window_start = @arrival_window_start')
    expect(sql).toContain('arrival_window_tz = @arrival_window_tz')
    expect(sql).toContain('is_committed = @is_committed')
    expect(sql).not.toContain('is_confirmed')
    expect(sql).toContain('modified_by = @modified_by')
    expect(opts.params).toContainEqual({ name: 'is_committed', value: true })
    expect(opts.params).toContainEqual({ name: 'modified_by', value: null })
    expect(opts.params).toContainEqual({ name: 'id', value: 5 })
    expect(recomputeMock).toHaveBeenCalledWith('Server=a,1433', 100)
  })

  it('clears is_committed when committed is false', async () => {
    const res = await patch('5', { estimated_date: '2026-11-03', committed: false })
    expect(res.status).toBe(200)
    const [, sql, opts] = updateCall()!
    expect(sql).not.toContain('arrival_window_start')
    expect(opts.params).toContainEqual({ name: 'is_committed', value: false })
  })

  it('accepts SIT-IN (delivery to storage) activities', async () => {
    routeSql(activityRow({ ActivityType_code: 'SITIN' }))
    const res = await patch('5', { estimated_date: '2026-11-02', committed: true })
    expect(res.status).toBe(200)
  })

  it('allows the trip driver when the activity has no assigned driver', async () => {
    routeSql(activityRow({ assigned_driver_id: null }))
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(200)
  })

  it('treats assigned_driver_id 0 (the placeholder driver) as unassigned', async () => {
    routeSql(activityRow({ assigned_driver_id: 0 }))
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(200)
  })

  it('never lets a login mapped to driver 0 claim unassigned work', async () => {
    tenantUserFindMock.mockResolvedValue({ longhaulDriverId: 0 })
    routeSql(activityRow({ assigned_driver_id: 0, trip_driver_id: 0 }))
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('DRIVER_NOT_MAPPED')
    expect(updateCall()).toBeUndefined()
  })

  it("rejects another driver's activity with 403 and writes nothing", async () => {
    routeSql(activityRow({ assigned_driver_id: 7, trip_driver_id: 7 }))
    const res = await patch('5', { estimated_date: '2026-11-02', committed: true })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('NOT_YOUR_ACTIVITY')
    expect(updateCall()).toBeUndefined()
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it('rejects a login with no driver mapping with 403', async () => {
    tenantUserFindMock.mockResolvedValue({ longhaulDriverId: null })
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('DRIVER_NOT_MAPPED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('rejects a principal with no user (M2M) with 403', async () => {
    const res = await buildApp('').request('/onprem/longhaul/driver/activities/5/eta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ committed: true }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects activity types other than RDEL / SITIN with 422 (SIT-OUT shares the SIT abbreviation)', async () => {
    routeSql(activityRow({ ActivityType_code: 'SITOUT' }))
    const res = await patch('5', { estimated_date: '2026-11-02', committed: true })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('ACTIVITY_TYPE_NOT_SUPPORTED')
    expect(updateCall()).toBeUndefined()
  })

  it('rejects an ETA date on a type without ETAs, but accepts its arrival window', async () => {
    routeSql(activityRow({ isHasETA: false }))
    const bad = await patch('5', { estimated_date: '2026-11-02', committed: true })
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { code: string }).code).toBe('ETA_NOT_SUPPORTED')

    const ok = await patch('5', { ...WINDOW, committed: true })
    expect(ok.status).toBe(200)
    const [, sql] = updateCall()!
    expect(sql).not.toContain('estimated_date')
    expect(sql).toContain('arrival_window_end = @arrival_window_end')
  })

  it('returns 404 when the activity does not exist', async () => {
    routeSql(null)
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(404)
  })

  it('rejects an invalid arrival window with 400', async () => {
    const res = await patch('5', {
      arrival_window_start: '10:00',
      arrival_window_end: '08:00',
      arrival_window_tz: 'America/Chicago',
      committed: true,
    })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('rejects a body without committed, and unknown columns, with 400', async () => {
    expect((await patch('5', { estimated_date: '2026-11-02' })).status).toBe(400)
    expect((await patch('5', { committed: true, is_confirmed: true })).status).toBe(400)
  })

  it('rejects a non-numeric id with 400', async () => {
    const res = await patch('x', { committed: true })
    expect(res.status).toBe(400)
  })

  it('normalizes the ETA to a calendar day', async () => {
    await patch('5', { estimated_date: '2026-11-02T05:00:00.000Z', committed: true })
    const [, , opts] = updateCall()!
    const param = opts.params.find((p: { name: string }) => p.name === 'estimated_date')
    expect(String(param.value)).toMatch(/^2026-11-02/)
    expect(String(param.value)).not.toContain('05:00')
  })

  it('returns 422 when the tenant has no legacy DB', async () => {
    tenantFindMock.mockResolvedValue({ mssqlConnectionString: null })
    const res = await patch('5', { committed: true })
    expect(res.status).toBe(422)
  })
})
