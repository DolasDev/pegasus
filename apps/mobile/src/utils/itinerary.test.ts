import type { ItineraryItem } from '../types/itinerary'
import {
  addDays,
  formatWindow,
  formatDay,
  formatRange,
  groupItinerary,
  localDay,
  rangeFrom,
  shiftRange,
  stopTitle,
} from './itinerary'

const HOME = { street: '1 Elm St', unit: null, city: 'Austin', state: 'TX', zip: '78701' }
const OFFICE = { street: '9 Oak Ave', unit: 'Ste 2', city: 'Dallas', state: 'TX', zip: '75201' }

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
    day: '2026-10-27',
    plannedStart: '2026-10-27',
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

describe('day arithmetic', () => {
  it('adds days on the calendar, across months and years', () => {
    expect(addDays('2026-10-27', 6)).toBe('2026-11-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('pages a 7-day inclusive window', () => {
    const r = rangeFrom('2026-10-27')
    expect(r).toEqual({ from: '2026-10-27', to: '2026-11-02' })
    expect(shiftRange(r, 1)).toEqual({ from: '2026-11-03', to: '2026-11-09' })
    expect(shiftRange(r, -1)).toEqual({ from: '2026-10-20', to: '2026-10-26' })
  })

  it('reads the device local day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('labels days and ranges without the device zone', () => {
    expect(formatDay('2026-10-27')).toBe('Tue Oct 27')
    expect(formatRange({ from: '2026-10-27', to: '2026-11-02' })).toBe('Oct 27 – Nov 2')
  })
})

describe('formatWindow', () => {
  it('names the zone only when the source has one', () => {
    expect(formatWindow({ start: '08:00', end: '10:00', tz: null })).toBe('08:00 – 10:00')
    expect(formatWindow({ start: '08:00', end: '10:00', tz: 'America/Chicago' })).toBe(
      '08:00 – 10:00 (America/Chicago)',
    )
  })
})

describe('groupItinerary', () => {
  it('groups by day, then by place, keeping the API order within a stop', () => {
    const days = groupItinerary([
      item({ key: 'a', actCode: 'PACK', sequence: 1 }),
      item({ key: 'b', place: OFFICE, actCode: 'RDEL', sequence: 5 }),
      item({ key: 'c', actCode: 'LOAD', sequence: 2 }),
      item({ key: 'd', day: '2026-10-28' }),
    ])

    expect(days.map((d) => d.day)).toEqual(['2026-10-27', '2026-10-28'])
    expect(days[0].stops.map((s) => s.items.map((i) => i.key))).toEqual([['a', 'c'], ['b']])
    expect(days[1].stops).toHaveLength(1)
  })

  it('treats the same address with different casing/spacing as one stop', () => {
    const days = groupItinerary([
      item({ key: 'a' }),
      item({ key: 'b', place: { ...HOME, street: ' 1 ELM ST ' } }),
    ])
    expect(days[0].stops).toHaveLength(1)
  })

  it('groups place-less items by their note, else by order under "No address"', () => {
    const days = groupItinerary([
      item({ key: 'a', place: null, placeNote: 'Warehouse B' }),
      item({ key: 'b', place: null, placeNote: null, kind: 'storage' }),
      item({ key: 'c', place: null, placeNote: 'warehouse b' }),
      item({ key: 'd', place: { street: null, unit: null, city: null, state: 'TX', zip: null } }),
      item({ key: 'e', place: null, placeNote: null, orderNum: 300 }),
    ])
    const stops = days[0].stops
    expect(stops.map((s) => s.items.map((i) => i.key))).toEqual([['a', 'c'], ['b', 'd'], ['e']])
    expect(stopTitle(stops[0])).toBe('Warehouse B')
    expect(stopTitle(stops[1])).toBe('No address')
  })

  it('titles a stop by its street, else its city line', () => {
    const [day] = groupItinerary([
      item({ key: 'a', place: OFFICE }),
      item({ key: 'b', place: { street: null, unit: null, city: 'Waco', state: 'TX', zip: null } }),
    ])
    expect(day.stops.map(stopTitle)).toEqual(['9 Oak Ave, Ste 2', 'Waco, TX'])
  })
})
