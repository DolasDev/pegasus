import { describe, it, expect } from 'vitest'
import type { ItineraryItem } from '@/api/queries/driver-itinerary'
import {
  addDays,
  formatDay,
  formatRange,
  formatWindow,
  groupItinerary,
  rangeFrom,
  shiftRange,
  sourceLabel,
  stopTitle,
} from './itinerary-view'

const HOME = { street: '1 Elm St', unit: null, city: 'Austin', state: 'TX', zip: '78701' }

function item(partial: Partial<ItineraryItem>): ItineraryItem {
  return {
    key: 'k',
    source: { kind: 'longhaul-activity', activityId: 1 },
    orderNum: 100,
    shipperName: 'Smith',
    actCode: 'PACK',
    actName: 'Pack',
    known: true,
    kind: 'act',
    side: 'origin',
    place: HOME,
    placeNote: null,
    day: '2026-11-02',
    plannedStart: '2026-11-02',
    plannedEnd: null,
    estimated: null,
    actual: null,
    arrivalWindow: null,
    committed: false,
    confirmed: false,
    sequence: 1,
    tripId: null,
    tripStatus: null,
    drivers: { longhaul: [], local: [] },
    ...partial,
  }
}

describe('range', () => {
  it('pages a 7-day inclusive week on the calendar', () => {
    expect(rangeFrom('2026-10-27')).toEqual({ from: '2026-10-27', to: '2026-11-02' })
    expect(shiftRange(rangeFrom('2026-10-27'), -1)).toEqual({
      from: '2026-10-20',
      to: '2026-10-26',
    })
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(formatDay('2026-11-02')).toBe('Mon Nov 2')
    expect(formatRange({ from: '2026-10-27', to: '2026-11-02' })).toBe('Oct 27 – Nov 2')
  })

  it('shows a one-time window as one time, with its zone when known', () => {
    expect(formatWindow({ start: '08:00', end: '08:00', tz: null })).toBe('08:00')
    expect(formatWindow({ start: '08:00', end: '10:00', tz: 'America/Chicago' })).toBe(
      '08:00 – 10:00 (America/Chicago)',
    )
  })
})

describe('groupItinerary', () => {
  it('groups by day, then by place, keeping the API order', () => {
    const days = groupItinerary([
      item({ key: 'a' }),
      item({ key: 'b', place: { ...HOME, street: '9 Oak Ave' } }),
      item({ key: 'c', actCode: 'LOAD' }),
      item({ key: 'd', day: '2026-11-03' }),
    ])
    expect(days.map((d) => d.stops.map((s) => s.items.map((i) => i.key)))).toEqual([
      [['a', 'c'], ['b']],
      [['d']],
    ])
  })

  it('never merges unrelated address-less work into one stop', () => {
    const [day] = groupItinerary([
      item({ key: 'a', place: null, orderNum: 1 }),
      item({ key: 'b', place: null, orderNum: 2 }),
      item({ key: 'c', place: null, placeNote: 'Warehouse B', orderNum: 3 }),
    ])
    expect(day!.stops.map((s) => [stopTitle(s), s.items.length])).toEqual([
      ['No address', 1],
      ['No address', 1],
      ['Warehouse B', 1],
    ])
  })
})

describe('sourceLabel', () => {
  it('names where the work is recorded', () => {
    expect(sourceLabel(item({ tripId: 55 }))).toBe('Trip 55')
    expect(
      sourceLabel(item({ source: { kind: 'order-assigned', orderNum: 1, actCode: 'RDEL' } })),
    ).toBe('Order')
    expect(
      sourceLabel(item({ source: { kind: 'local-job-token', jobId: 9, token: 'PACK' } })),
    ).toBe('Local job')
  })
})
