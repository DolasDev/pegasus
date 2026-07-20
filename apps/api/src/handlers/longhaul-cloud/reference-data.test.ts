// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /reference-data batched handler.
//
// This handler collapses the seven per-bootstrap reference-data fetches
// (drivers, trip-statuses, states, zones, planners, dispatchers,
// filter-options) into one multi-statement MSSQL batch. Tests cover the
// happy paths for both per-client variants (nwi/qmm), the graceful
// degradation when the tenant has no `longhaulClient` configured (5 of 7
// keys populated, dispatchers + filter-options empty — NOT a 422), and the
// usual MSSQL_NOT_CONFIGURED / INTERNAL_ERROR failure modes.
//
// Prisma and the mssql-executor client are mocked — these tests never touch
// Postgres or the executor Lambda.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: { tenant: { findUnique: vi.fn() } },
}))
vi.mock('../../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { longhaulReferenceDataHandler } from './reference-data'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const findUnique = db.tenant.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get('/onprem/longhaul/reference-data', longhaulReferenceDataHandler)
  return app
}

const drivers = [{ driver_id: 1, driver_name: 'Alice' }]
const tripStatuses = [{ status_id: 1, status: 'PLANNED' }]
const states = [{ id: 1, code: 'CA' }]
const zones = [{ zone_id: 1, zone_name: 'North' }]
const planners = [{ code: 'P1', name: 'Planner One' }]
const dispatchers = [{ code: 'D1', name: 'Dispatcher One' }]
const moveTypes = [
  { move_type_desc: 'Local', move_type: 'L' },
  { move_type_desc: 'National', move_type: 'N' },
]

describe('GET longhaul/reference-data (cloud-direct, batched)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all 7 reference lookups for an nwi tenant in one executeSql call', async () => {
    findUnique.mockResolvedValue({
      mssqlConnectionString: 'Server=a,1433',
      longhaulClient: 'nwi',
    })
    executeSqlMock.mockResolvedValue({
      recordset: drivers,
      recordsets: [drivers, tripStatuses, states, zones, planners, dispatchers, moveTypes],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/reference-data')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toEqual({
      drivers,
      tripStatuses,
      states,
      zones,
      planners,
      dispatchers,
      filterOptions: {
        moveType: [
          { value: 'L', label: 'Local' },
          { value: 'N', label: 'National' },
        ],
      },
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const [connStr, sql] = executeSqlMock.mock.calls[0]!
    expect(connStr).toBe('Server=a,1433')
    // Batch should include all 7 statements in the documented order.
    expect(sql).toContain('v_longhaul_drivers')
    expect(sql).toContain('MasterTripStatus')
    expect(sql).toContain('v_longhaul_states')
    expect(sql).toContain('v_longhaul_zones')
    expect(sql).toContain('v_longhaul_salesman')
    // nwi-specific fragments must appear when client = nwi. The dispatcher
    // filter ORs in the 'LO' short-haul/local-dispatch role alongside the
    // long-haul managed_by_id, so both groups list in the planning system.
    expect(sql).toContain("(managed_by_id = 2021 OR roles like '%LO%')")
    expect(sql).toContain('MoveType')
    expect(sql).toContain('1=1')
    // Both v_longhaul_salesman statements (planners + dispatchers) must be
    // restricted to active staff, and the per-client fragment must stay
    // parenthesised so its OR can't escape the AND. Lowercase `active` is
    // distinct from the drivers view's uppercase ACTIVE.
    expect(sql).toContain("[v_longhaul_salesman].active = 'Y'")
    expect(sql).toContain("active = 'Y' AND ((managed_by_id = 2021 OR roles like '%LO%'))")
  })

  it('omits per-client statements (and returns empty dispatchers + filterOptions) when longhaulClient is null', async () => {
    findUnique.mockResolvedValue({
      mssqlConnectionString: 'Server=a,1433',
      longhaulClient: null,
    })
    executeSqlMock.mockResolvedValue({
      recordset: drivers,
      recordsets: [drivers, tripStatuses, states, zones, planners],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/reference-data')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toEqual({
      drivers,
      tripStatuses,
      states,
      zones,
      planners,
      dispatchers: [],
      filterOptions: { moveType: [] },
    })
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const sql = executeSqlMock.mock.calls[0]![1] as string
    // Batch should NOT reference the per-client tables/fragments.
    expect(sql).not.toContain('MoveType')
    expect(sql).not.toContain('managed_by_id')
    expect(sql).not.toContain('roles like')
    // Planners is client-independent, so its active filter survives the
    // degraded (no longhaulClient) batch.
    expect(sql).toContain("[v_longhaul_salesman].active = 'Y'")
  })

  it('uses qmm per-client fragments when the tenant is a qmm client', async () => {
    findUnique.mockResolvedValue({
      mssqlConnectionString: 'Server=a,1433',
      longhaulClient: 'qmm',
    })
    executeSqlMock.mockResolvedValue({
      recordset: drivers,
      recordsets: [drivers, tripStatuses, states, zones, planners, dispatchers, moveTypes],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/reference-data')

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
    const sql = executeSqlMock.mock.calls[0]![1] as string
    expect(sql).toContain("active = 'Y' AND (roles like ('%cpd%'))")
    expect(sql).toContain("move_type in ('C','S','N','M','U')")
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null, longhaulClient: 'nwi' })

    const res = await buildApp().request('/onprem/longhaul/reference-data')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the executor call fails', async () => {
    findUnique.mockResolvedValue({
      mssqlConnectionString: 'Server=a,1433',
      longhaulClient: 'nwi',
    })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/reference-data')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })
})
