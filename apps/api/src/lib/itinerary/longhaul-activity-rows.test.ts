import { describe, it, expect } from 'vitest'
import { longhaulActivityItem, type LonghaulActivityRow } from './longhaul-activity-rows'

function row(overrides: Partial<LonghaulActivityRow> = {}): LonghaulActivityRow {
  return {
    id: 9001,
    order_num: 493013,
    TripMaster_id: 16426,
    ActivityType_code: 'RDEL',
    planned_start: '2026-10-20T00:00:00.000Z',
    planned_end: '2026-10-22T00:00:00.000Z',
    estimated_date: null,
    actual_date: null,
    street: '2 DEST AVE ',
    unit: '',
    city: 'PETOSKEY',
    state: 'MI',
    zip: 49770,
    is_committed: false,
    is_confirmed: true,
    assigned_driver_id: 0,
    trip_driver_id: 1203,
    it_type_name: 'Del',
    it_type_abbreviation: 'Deliver',
    it_type_at_origin: false,
    it_type_at_destination: true,
    it_type_sequence: 90,
    it_shipper_name: 'SMITH, JANE ',
    ...overrides,
  }
}

describe('longhaulActivityItem', () => {
  it('maps the act, its trip and its own address', () => {
    expect(longhaulActivityItem(row())).toMatchObject({
      key: 'longhaul-activity:9001',
      source: { kind: 'longhaul-activity', activityId: 9001 },
      orderNum: 493013,
      shipperName: 'SMITH, JANE',
      actCode: 'RDEL',
      actName: 'Del',
      known: true,
      kind: 'act',
      side: 'destination',
      place: { street: '2 DEST AVE', unit: null, city: 'PETOSKEY', state: 'MI', zip: '49770' },
      tripId: 16426,
      sequence: 90,
      confirmed: true,
      committed: false,
    })
  })

  it('takes the day from actual, then ETA, then planned start', () => {
    expect(longhaulActivityItem(row())?.day).toBe('2026-10-20')
    expect(longhaulActivityItem(row({ estimated_date: '2026-10-21T00:00:00.000Z' }))?.day).toBe(
      '2026-10-21',
    )
    expect(
      longhaulActivityItem(
        row({
          estimated_date: '2026-10-21T00:00:00.000Z',
          actual_date: '2026-10-23T00:00:00.000Z',
        }),
      )?.day,
    ).toBe('2026-10-23')
  })

  it('keeps the calendar day of a pre-#534 row stored at 05:00', () => {
    expect(longhaulActivityItem(row({ planned_start: '2026-09-17T05:00:00.000Z' }))?.day).toBe(
      '2026-09-17',
    )
  })

  it('names the owner the ETA editor would: the assigned driver, else the trip driver', () => {
    expect(longhaulActivityItem(row())?.drivers).toEqual({ longhaul: [1203], local: [] })
    expect(longhaulActivityItem(row({ assigned_driver_id: 77 }))?.drivers).toEqual({
      longhaul: [77],
      local: [],
    })
    expect(
      longhaulActivityItem(row({ assigned_driver_id: null, trip_driver_id: 0 }))?.drivers,
    ).toEqual({ longhaul: [], local: [] })
  })

  it('reads a complete arrival window, and ignores a partial one', () => {
    const full = longhaulActivityItem(
      row({
        arrival_window_start: '08:00',
        arrival_window_end: '10:00',
        arrival_window_tz: 'America/Detroit',
      }),
    )
    expect(full?.arrivalWindow).toEqual({ start: '08:00', end: '10:00', tz: 'America/Detroit' })
    expect(longhaulActivityItem(row({ arrival_window_start: '08:00' }))?.arrivalWindow).toBeNull()
    // A tenant that never set a window has no such columns at all.
    expect(longhaulActivityItem(row())?.arrivalWindow).toBeNull()
  })

  it('carries the trip status, so an Offered trip can be marked', () => {
    expect(longhaulActivityItem(row({ it_trip_status: 'Offered ' }))?.tripStatus).toBe('Offered')
    expect(longhaulActivityItem(row({ TripMaster_id: null }))?.tripStatus).toBeNull()
  })

  it('marks SIT and warehouse work as storage, with no customer address', () => {
    const sit = longhaulActivityItem(row({ ActivityType_code: 'SITIN' }))
    expect(sit).toMatchObject({ kind: 'storage', place: null })
  })

  it('falls back to the code when the catalog has no row for it', () => {
    const odd = longhaulActivityItem(
      row({
        ActivityType_code: 'CFA',
        it_type_name: null,
        it_type_abbreviation: null,
        it_type_sequence: null,
      }),
    )
    expect(odd).toMatchObject({ actCode: 'CFA', actName: 'CFA', known: false, sequence: 999 })
  })

  it('is null for a row with no date at all — it cannot be placed on a day', () => {
    expect(longhaulActivityItem(row({ planned_start: null }))).toBeNull()
  })
})
