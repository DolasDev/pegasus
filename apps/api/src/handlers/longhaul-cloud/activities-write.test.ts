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

  // The date columns are calendar days. tenant-web used to persist
  // `date.toISOString()` off a local-time Date, so a day picked in US-Eastern
  // was stored at 05:00 — the same day, five hours off. Before #534 the Gantt
  // keyed columns by the full timestamp, so that 05:00 value and the day-walk's
  // 00:00 value rendered as two columns both labeled "08/16". Trip 16426 showed
  // exactly this. Normalizing here covers tenant-web, trip-save and SDK callers.
  describe('date-only columns', () => {
    const paramFor = (name: string) =>
      (executeSqlMock.mock.calls[1]![2].params as Array<{ name: string; value: unknown }>).find(
        (p) => p.name === name,
      )

    it('stores a picked-in-Eastern ETA at midnight, not 05:00', async () => {
      const res = await save('5', { estimated_date: '2026-08-16T05:00:00.000Z' })
      expect(res.status).toBe(200)
      expect(paramFor('estimated_date')).toEqual({
        name: 'estimated_date',
        value: '2026-08-16 00:00:00',
      })
    })

    it('passes an unambiguous YYYY-MM-DD straight through', async () => {
      await save('5', { actual_date: '2026-08-10' })
      expect(paramFor('actual_date')).toEqual({ name: 'actual_date', value: '2026-08-10 00:00:00' })
    })

    it('normalizes planned_start/planned_end too (the PendingTrips editor)', async () => {
      await save('5', {
        planned_start: '2026-08-20T05:00:00.000Z',
        planned_end: '2026-08-25T05:00:00.000Z',
      })
      expect(paramFor('planned_start')!.value).toBe('2026-08-20 00:00:00')
      expect(paramFor('planned_end')!.value).toBe('2026-08-25 00:00:00')
    })

    it('keeps an explicit null null rather than coercing it to a date', async () => {
      await save('5', { actual_date: null })
      expect(paramFor('actual_date')).toEqual({ name: 'actual_date', value: null })
    })

    it('leaves non-date columns untouched', async () => {
      await save('5', { city: 'Reno' })
      expect(paramFor('city')).toEqual({ name: 'city', value: 'Reno' })
    })

    // A plan date may legitimately fall outside the date spread, so for an RDEL
    // `plannedEnd` (= shipment.plan_del) can legitimately precede `plannedStart`
    // (= shipment.del_date2) — see peg-dates.ts. #619 rejected that shape, which
    // 400'd edits on the 8 prod activities that carry it and blocked their trips
    // from saving at all.
    it('accepts a legitimately inverted planned span', async () => {
      const res = await save('5', {
        planned_start: '2021-03-19T00:00:00.000Z',
        planned_end: '2021-03-01T00:00:00.000Z',
      })
      expect(res.status).toBe(200)
      expect(paramFor('planned_start')!.value).toBe('2021-03-19 00:00:00')
      expect(paramFor('planned_end')!.value).toBe('2021-03-01 00:00:00')
    })

    it('accepts an ETA edit on an activity whose stored span is inverted', async () => {
      // The PATCH touches only estimated_date; the stored bounds must not veto it.
      executeSqlMock.mockReset()
      executeSqlMock
        .mockResolvedValueOnce({
          recordset: [
            {
              TripMaster_id: 100,
              planned_start: '2021-03-19T00:00:00.000Z',
              planned_end: '2021-03-01T00:00:00.000Z',
            },
          ],
          recordsets: [[]],
          rowsAffected: [],
        })
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [1] })
      const res = await save('5', { estimated_date: '2021-02-26' })
      expect(res.status).toBe(200)
    })

    // The real defect class was never "inverted" — it was sentinel/typo years.
    it.each(['1969-12-17', '1952-01-01', '2000-03-08', '2012-01-01'])(
      'rejects the implausible year %s with 400 and writes nothing',
      async (bad) => {
        const res = await save('5', { actual_date: bad })
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
        expect(executeSqlMock.mock.calls.length).toBeLessThan(2)
        expect(recomputeMock).not.toHaveBeenCalled()
      },
    )

    it('accepts a current-era date', async () => {
      const res = await save('5', { actual_date: '2026-08-12' })
      expect(res.status).toBe(200)
    })
  })
})
