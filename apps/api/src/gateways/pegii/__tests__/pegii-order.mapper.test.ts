import { describe, it, expect } from 'vitest'
import { mapPegiiOrderToRecord } from '../pegii-order.mapper'
import type { PegiiOrderDto } from '../pegii-order.dto'

describe('mapPegiiOrderToRecord', () => {
  it('maps a fully-populated serialized order onto the OrderRecord shape', () => {
    const dto: PegiiOrderDto = {
      SaleId: 4210,
      OrderNumber: 'SO-4210',
      Status: 'InProgress',
      CustomerName: 'Acme Corp',
      ScheduledDate: '2026-08-01',
      PackingActualDate: '2026-07-30',
      CreatedDate: '2026-07-01T09:00:00.000Z',
      ModifiedDate: '2026-07-12T15:30:00.000Z',
    }

    expect(mapPegiiOrderToRecord(dto)).toEqual({
      id: '4210',
      orderNumber: 'SO-4210',
      status: 'in_progress',
      customerName: 'Acme Corp',
      scheduledDate: '2026-08-01',
      packingActualDate: '2026-07-30',
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-12T15:30:00.000Z',
    })
  })

  it('fills gaps: derives orderNumber, defaults status to booked, epochs timestamps', () => {
    const record = mapPegiiOrderToRecord({ SaleId: '77' })
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
    expect(mapPegiiOrderToRecord({ SaleId: 1, Status: raw }).status).toBe(expected)
  })
})
