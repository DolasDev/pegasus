// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct PATCH /driver-planning/:driverId handler.
// resolveLonghaulUser and executeSql are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-user', () => ({ resolveLonghaulUser: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import { longhaulDriverPlanningPatchHandler } from './driver-planning-patch'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { executeSql } from '../../lib/mssql-executor-client'

const resolveMock = resolveLonghaulUser as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    await next()
  })
  app.patch('/onprem/longhaul/driver-planning/:driverId', longhaulDriverPlanningPatchHandler)
  return app
}

function patch(driverId: string, body: unknown) {
  return buildApp().request(`/onprem/longhaul/driver-planning/${driverId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH longhaul/driver-planning/:driverId (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMock.mockResolvedValue({
      ok: true,
      connectionString: 'Server=a,1433',
      code: 7,
      user: {},
    })
    executeSqlMock.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [1] })
  })

  it('upserts confirmed availability and stamps the resolved user code', async () => {
    const res = await patch('42', {
      confirmedDate: '2026-06-01',
      confirmedLocation: 'City, ST',
      notes: 'hello',
      canada: true,
      california: false,
      rating: 4.7,
      equipment: 'Tractor Trailer',
      homeCity: 'Austin',
      homeState: 'TX',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    // Call 0 is the schema-ensure (no params); call 1 is the upsert.
    const [, , opts] = executeSqlMock.mock.calls[1]!
    expect(opts.params).toEqual([
      { name: 'driver_id', value: 42 },
      { name: 'confirmed_date', value: '2026-06-01' },
      { name: 'confirmed_location', value: 'City, ST' },
      { name: 'notes', value: 'hello' },
      { name: 'canada', value: true },
      { name: 'california', value: false },
      { name: 'rating', value: 4.7 },
      { name: 'equipment', value: 'Tractor Trailer' },
      { name: 'home_city', value: 'Austin' },
      { name: 'home_state', value: 'TX' },
      { name: 'updated_by', value: 7 },
    ])
  })

  it('defaults missing optional fields to null', async () => {
    await patch('42', { confirmedDate: null, confirmedLocation: null })
    // Call 0 is the schema-ensure (no params); call 1 is the upsert.
    const [, , opts] = executeSqlMock.mock.calls[1]!
    expect(opts.params).toContainEqual({ name: 'notes', value: null })
    expect(opts.params).toContainEqual({ name: 'canada', value: null })
    expect(opts.params).toContainEqual({ name: 'california', value: null })
    expect(opts.params).toContainEqual({ name: 'rating', value: null })
    expect(opts.params).toContainEqual({ name: 'equipment', value: null })
    expect(opts.params).toContainEqual({ name: 'home_city', value: null })
    expect(opts.params).toContainEqual({ name: 'home_state', value: null })
  })

  it('returns 400 for a non-numeric driver id', async () => {
    const res = await patch('abc', { confirmedDate: null, confirmedLocation: null })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('propagates the auth error from resolveLonghaulUser', async () => {
    resolveMock.mockResolvedValue({
      ok: false,
      status: 422,
      error: 'unmapped',
      code: 'LONGHAUL_USER_NOT_MAPPED',
    })
    const res = await patch('42', { confirmedDate: null, confirmedLocation: null })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('LONGHAUL_USER_NOT_MAPPED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor write fails', async () => {
    executeSqlMock.mockRejectedValue(new Error('boom'))
    const res = await patch('42', { confirmedDate: null, confirmedLocation: null })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
