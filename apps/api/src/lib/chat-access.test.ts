// Unit tests for chat's legacy-database reads. The mssql-executor client and the
// base Prisma client are mocked; assertions pin the SQL predicates and the
// fail-closed behavior, since these decide who can read a move's chat.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('../db', () => ({ db: { tenant: { findUnique: vi.fn() } } }))
vi.mock('./mssql-executor-client', () => ({ executeSql: vi.fn() }))

import { db } from '../db'
import { executeSql } from './mssql-executor-client'
import {
  legacyConnectionString,
  driverCanReadOrder,
  driverReadableOrders,
  assignedDriverIds,
  orderExists,
  listLocalDrivers,
} from './chat-access'

const exec = executeSql as unknown as Mock
const findTenant = db.tenant.findUnique as unknown as Mock
const CS = 'Server=x'

beforeEach(() => {
  exec.mockReset()
  findTenant.mockReset()
})

function lastSql(): string {
  return exec.mock.calls.at(-1)?.[1] as string
}
function lastParams(): Array<{ name: string; value: unknown }> {
  return (exec.mock.calls.at(-1)?.[2] as { params: Array<{ name: string; value: unknown }> }).params
}

describe('legacyConnectionString', () => {
  it('returns the tenant connection string, or null when unset', async () => {
    findTenant.mockResolvedValueOnce({ mssqlConnectionString: CS })
    expect(await legacyConnectionString('t1')).toBe(CS)
    findTenant.mockResolvedValueOnce({ mssqlConnectionString: null })
    expect(await legacyConnectionString('t1')).toBeNull()
    findTenant.mockResolvedValueOnce(null)
    expect(await legacyConnectionString('t1')).toBeNull()
  })
})

describe('driverCanReadOrder', () => {
  it('denies without touching the database when the login maps to no driver', async () => {
    expect(
      await driverCanReadOrder(CS, 10, { longhaulDriverId: null, localDriverEmployeeId: 0 }),
    ).toBe(false)
    expect(exec).not.toHaveBeenCalled()
  })

  it('checks the longhaul trip rule only when only a longhaul id is mapped', async () => {
    exec.mockResolvedValue({ recordset: [{ ok: 1 }] })
    expect(
      await driverCanReadOrder(CS, 10, { longhaulDriverId: 7, localDriverEmployeeId: null }),
    ).toBe(true)
    expect(lastSql()).toContain('LongDistanceDispatchActivity')
    expect(lastSql()).not.toContain('LocalDispatchJobs')
    expect(lastParams()).toEqual([
      { name: 'orderNum', value: 10 },
      { name: 'lh', value: 7 },
    ])
  })

  it('checks the local driver slots only (never helpers) when only a local id is mapped', async () => {
    exec.mockResolvedValue({ recordset: [{ ok: 0 }] })
    expect(
      await driverCanReadOrder(CS, 10, { longhaulDriverId: null, localDriverEmployeeId: 9 }),
    ).toBe(false)
    expect(lastSql()).toContain('j.driver_id1 = @ld OR j.driver_id2 = @ld')
    expect(lastSql()).not.toContain('helper_id')
    expect(lastSql()).not.toContain('LongDistanceDispatchActivity')
  })

  it('ORs both rules when both ids are mapped', async () => {
    exec.mockResolvedValue({ recordset: [{ ok: 1 }] })
    await driverCanReadOrder(CS, 10, { longhaulDriverId: 7, localDriverEmployeeId: 9 })
    expect(lastSql()).toMatch(
      /LongDistanceDispatchActivity[\s\S]*\) OR EXISTS[\s\S]*LocalDispatchJobs/,
    )
  })

  it('fails closed when the legacy query errors', async () => {
    exec.mockRejectedValue(new Error('Invalid object name LocalDispatchJobs'))
    expect(
      await driverCanReadOrder(CS, 10, { longhaulDriverId: null, localDriverEmployeeId: 9 }),
    ).toBe(false)
  })
})

describe('driverReadableOrders', () => {
  it('returns the subset of candidate orders the driver can read, in one query', async () => {
    exec.mockResolvedValue({ recordset: [{ order_num: 11 }, { order_num: 13 }] })
    const out = await driverReadableOrders(CS, [11, 12, 13], {
      longhaulDriverId: 7,
      localDriverEmployeeId: null,
    })
    expect(out).toEqual(new Set([11, 13]))
    expect(exec).toHaveBeenCalledTimes(1)
    expect(lastSql()).toContain('VALUES (@o0), (@o1), (@o2)')
  })

  it('short-circuits with no candidates or no mapping', async () => {
    expect(
      await driverReadableOrders(CS, [], { longhaulDriverId: 7, localDriverEmployeeId: null }),
    ).toEqual(new Set())
    expect(
      await driverReadableOrders(CS, [1], { longhaulDriverId: null, localDriverEmployeeId: null }),
    ).toEqual(new Set())
    expect(exec).not.toHaveBeenCalled()
  })

  it('fails closed on a query error', async () => {
    exec.mockRejectedValue(new Error('timeout'))
    expect(
      await driverReadableOrders(CS, [1], { longhaulDriverId: 7, localDriverEmployeeId: null }),
    ).toEqual(new Set())
  })
})

describe('assignedDriverIds', () => {
  it('collects longhaul and local driver ids, dropping 0/null and duplicates', async () => {
    exec.mockImplementation((_cs: string, sql: string) =>
      Promise.resolve({
        recordset: sql.includes('LocalDispatchJobs')
          ? [
              { driver_id1: 9, driver_id2: 0 },
              { driver_id1: 9, driver_id2: 12 },
            ]
          : [
              { assigned_driver_id: 7, trip_driver_id: null },
              { assigned_driver_id: 0, trip_driver_id: 7 },
              { assigned_driver_id: 8, trip_driver_id: 7 },
            ],
      }),
    )
    expect(await assignedDriverIds(CS, 10)).toEqual({ longhaul: [7, 8], local: [9, 12] })
  })

  it('keeps one side when the other table is missing on this tenant', async () => {
    exec.mockImplementation((_cs: string, sql: string) =>
      sql.includes('LocalDispatchJobs')
        ? Promise.reject(new Error('Invalid object name'))
        : Promise.resolve({ recordset: [{ assigned_driver_id: 7, trip_driver_id: null }] }),
    )
    expect(await assignedDriverIds(CS, 10)).toEqual({ longhaul: [7], local: [] })
  })

  it('ignores deactivated local jobs', async () => {
    exec.mockResolvedValue({ recordset: [] })
    await assignedDriverIds(CS, 10)
    const localSql = exec.mock.calls
      .map((c) => c[1] as string)
      .find((s) => s.includes('LocalDispatchJobs'))
    expect(localSql).toContain("ISNULL(j.active, 'Y') <> 'N'")
  })
})

describe('orderExists', () => {
  it('looks the order up in sales', async () => {
    exec.mockResolvedValueOnce({ recordset: [{ one: 1 }] })
    expect(await orderExists(CS, 10)).toBe(true)
    expect(lastSql()).toContain('FROM sales')
    exec.mockResolvedValueOnce({ recordset: [] })
    expect(await orderExists(CS, 11)).toBe(false)
  })
})

describe('listLocalDrivers', () => {
  it('lists active local drivers with a display name', async () => {
    exec.mockResolvedValue({
      recordset: [
        { employee_id: 3, first: 'ANN', last: 'LEE' },
        { employee_id: 4, first: '', last: 'TUNYLA, EDWARD' },
      ],
    })
    expect(await listLocalDrivers(CS)).toEqual([
      { employeeId: 3, name: 'LEE, ANN' },
      { employeeId: 4, name: 'TUNYLA, EDWARD' },
    ])
    expect(lastSql()).toContain("is_local_drv = 'Y'")
    expect(lastSql()).toContain("active = 'Y'")
  })
})
