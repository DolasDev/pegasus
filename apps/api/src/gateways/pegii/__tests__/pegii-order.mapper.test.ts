import { describe, it, expect } from 'vitest'
import { mapPegiiOrderToRecord } from '../pegii-order.mapper'
import type { PegiiOrderDto } from '../pegii-order.dto'

describe('mapPegiiOrderToRecord', () => {
  it('maps a fully-populated native serialized order onto the OrderRecord shape', () => {
    const dto: PegiiOrderDto = {
      Id: 4210,
      Survey: { SerivceStatus: 'InProgress', ShipperName: 'Acme Corp' },
      InvolvedParties: { ShipperEmployer: { Identity: { Description: 'O-4210' } } },
      KeyMoveDates: { Survey: { Planned: '2026-08-01' }, Pack: { Actual: '2026-07-30' } },
      OrderDate: '2026-07-01T09:00:00.000Z',
      ModifiedDate: '2026-07-12T15:30:00.000Z',
    }

    expect(mapPegiiOrderToRecord(dto)).toEqual({
      id: '4210',
      orderNumber: 'O-4210',
      status: 'in_progress',
      customerName: 'Acme Corp',
      scheduledDate: '2026-08-01',
      packingActualDate: '2026-07-30',
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-12T15:30:00.000Z',
    })
  })

  it('fills gaps: derives orderNumber from Id, defaults status to booked, epochs timestamps', () => {
    const record = mapPegiiOrderToRecord({ Id: '77' })
    expect(record).toEqual({
      id: '77',
      orderNumber: 'SO-77',
      status: 'booked',
      customerName: null,
      scheduledDate: null,
      packingActualDate: null,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
  })

  it('returns null (never an "undefined" stub) when no real Id resolves', () => {
    // The 0029 bug: a payload where only status/updatedAt would populate.
    expect(mapPegiiOrderToRecord({ ModifiedDate: '2026-07-20T00:00:00.000Z' })).toBeNull()
    expect(mapPegiiOrderToRecord({})).toBeNull()
    expect(mapPegiiOrderToRecord({ Id: '  ' })).toBeNull()
    expect(mapPegiiOrderToRecord({ Id: null })).toBeNull()
  })

  it.each([
    ['booked', 'booked'],
    ['Open', 'booked'],
    ['Confirmed', 'booked'],
    ['in_progress', 'in_progress'],
    ['In Progress', 'in_progress'],
    ['Packing', 'in_progress'],
    ['completed', 'completed'],
    ['Closed', 'completed'],
    ['Delivered', 'completed'],
    ['something-unknown', 'booked'],
    [null, 'booked'],
  ] as const)('narrows legacy status %s → %s', (raw, expected) => {
    expect(mapPegiiOrderToRecord({ Id: 1, Survey: { SerivceStatus: raw } })?.status).toBe(expected)
  })
})
