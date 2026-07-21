import { describe, it, expect } from 'vitest'
import { mapPegiiSalesmanToRecord } from '../pegii-salesman.mapper'
import type { PegiiSalesmanDto } from '../pegii-salesman.dto'

describe('mapPegiiSalesmanToRecord', () => {
  it('maps a live serialized salesman sample onto the SalesmanRecord shape', () => {
    // Sample body from GET /api/v1/pegii/serialized/salesmen/213056 (inner `data`).
    const dto: PegiiSalesmanDto = {
      code: 213056,
      avlCode: '56',
      firstName: 'STEVE',
      lastName: 'GAVIN',
      title: 'VICE PRESIDENT OF CORPORATE SA',
      extension: '5226',
      email: 'sgavin@nelsonwesterberg.com',
      branch: '02',
      agencyCode: '1505',
      roles: 'SM',
      employeeType: 'S',
      isActive: true,
      startDate: '2017-04-17T00:00:00',
      dateTerminated: null,
    }

    expect(mapPegiiSalesmanToRecord(dto)).toEqual({
      id: '213056',
      avlCode: '56',
      firstName: 'STEVE',
      lastName: 'GAVIN',
      name: 'STEVE GAVIN',
      title: 'VICE PRESIDENT OF CORPORATE SA',
      email: 'sgavin@nelsonwesterberg.com',
      extension: '5226',
      branch: '02',
      agencyCode: '1505',
      roles: 'SM',
      employeeType: 'S',
      active: true,
      startDate: '2017-04-17T00:00:00',
      dateTerminated: null,
    })
  })

  it('composes name from first + last, tolerating a missing part', () => {
    expect(mapPegiiSalesmanToRecord({ code: 1, firstName: 'Sam' }).name).toBe('Sam')
    expect(mapPegiiSalesmanToRecord({ code: 1, lastName: 'Cole' }).name).toBe('Cole')
    expect(mapPegiiSalesmanToRecord({ code: 1, firstName: 'Sam', lastName: 'Cole' }).name).toBe(
      'Sam Cole',
    )
  })

  it('fills gaps: falls name back to the id, defaults active, nulls everything else', () => {
    const record = mapPegiiSalesmanToRecord({ code: '99' })
    expect(record).toEqual({
      id: '99',
      avlCode: null,
      firstName: null,
      lastName: null,
      name: '99',
      title: null,
      email: null,
      extension: null,
      branch: null,
      agencyCode: null,
      roles: null,
      employeeType: null,
      active: true,
      startDate: null,
      dateTerminated: null,
    })
  })

  it.each([
    [true, true],
    [false, false],
    ['Y', true],
    ['N', false],
    ['true', true],
    ['false', false],
    [1, true],
    [0, false],
    ['inactive', false],
    [null, true],
  ] as const)('coerces legacy active flag %s → %s', (raw, expected) => {
    expect(mapPegiiSalesmanToRecord({ code: 1, isActive: raw }).active).toBe(expected)
  })
})
