import { describe, it, expect } from 'vitest'
import { splitServices, localJobItems, type LocalJobRow } from './local-job-tokens'
import type { ActivityTypeEntry, OrderPlaces } from './types'

// The NW catalog as the 2026-10-25 prod check read it (abridged).
const CATALOG = new Map<string, ActivityTypeEntry>(
  [
    ['PACK', 'Pack', true, false, 10],
    ['LOAD', 'Load', true, false, 20],
    ['R19I', 'Agent Pickup', true, false, 40],
    ['WHSE', 'Warehousing', false, false, 60],
    ['SITIN', 'SIT-In', false, true, 70],
    ['SITOUT', 'SIT-Out', false, true, 80],
    ['RDEL', 'Del', false, true, 90],
    ['UNPK', 'Unpack', false, true, 100],
  ].map(([code, name, o, d, seq]) => [
    code as string,
    {
      code: code as string,
      name: name as string,
      abbreviation: name as string,
      isPerformedAtOrigin: o as boolean,
      isPerformedAtDestination: d as boolean,
      sequencePriority: seq as number,
    },
  ]),
)

const PLACES: OrderPlaces = {
  shipperName: 'SMITH, JANE',
  origin: { street: '1 ORIGIN ST', unit: null, city: 'CANTON', state: 'MI', zip: '48187' },
  destination: { street: '2 DEST AVE', unit: 'APT 4', city: 'PETOSKEY', state: 'MI', zip: '49770' },
}

function job(overrides: Partial<LocalJobRow> = {}): LocalJobRow {
  return {
    id: 7001,
    order_num: 493013,
    service_date: '2026-10-20T00:00:00.000Z',
    services: 'PACK LOAD',
    active: 'Y',
    is_final: 'N',
    is_confirmed: 'Y',
    eta_minimum: null,
    eta_maximum: null,
    start_time: null,
    end_time: null,
    service_at_orig: 'Y',
    service_at_dest: 'N',
    OriginLocation1: null,
    DestinationLocation1: null,
    driver_id1: 412,
    driver_id2: 0,
    ...overrides,
  }
}

describe('splitServices', () => {
  it('splits on whitespace and upper-cases', () => {
    expect(splitServices('pack  load')).toEqual(['PACK', 'LOAD'])
  })

  it('drops the trailing padding RVS stores', () => {
    expect(splitServices('XPU LOAD                       ')).toEqual(['XPU', 'LOAD'])
  })

  it('collapses the mirrored repeats the string is made of (a concatenation, not a count)', () => {
    expect(splitServices('PACK R19I R19I PACK')).toEqual(['PACK', 'R19I'])
    expect(splitServices('PACK WP LOAD SITIN WP LOAD PACK')).toEqual([
      'PACK',
      'WP',
      'LOAD',
      'SITIN',
    ])
  })

  it('is empty for empty, blank or non-string input', () => {
    expect(splitServices('')).toEqual([])
    expect(splitServices('   ')).toEqual([])
    expect(splitServices(null)).toEqual([])
  })
})

describe('localJobItems', () => {
  it('makes one item per distinct token, in catalog sequence', () => {
    const items = localJobItems(job({ services: 'LOAD PACK LOAD' }), PLACES, CATALOG)
    expect(items.map((i) => i.actCode)).toEqual(['PACK', 'LOAD'])
    expect(items.map((i) => i.key)).toEqual([
      'local-job-token:7001:PACK',
      'local-job-token:7001:LOAD',
    ])
  })

  it('puts origin-side work at the order origin and destination-side at the destination', () => {
    const items = localJobItems(job({ services: 'PACK RDEL' }), PLACES, CATALOG)
    const byCode = Object.fromEntries(items.map((i) => [i.actCode, i]))
    expect(byCode['PACK']?.side).toBe('origin')
    expect(byCode['PACK']?.place).toEqual(PLACES.origin)
    expect(byCode['RDEL']?.side).toBe('destination')
    expect(byCode['RDEL']?.place).toEqual(PLACES.destination)
  })

  it('gives storage work no customer address', () => {
    const items = localJobItems(job({ services: 'SITOUT WHSE' }), PLACES, CATALOG)
    for (const i of items) {
      expect(i.kind).toBe('storage')
      expect(i.place).toBeNull()
    }
  })

  it('knows the local-only codes the generator emits', () => {
    // Sorted by sequence: cartons go out before the wrap, debris comes after delivery.
    const [ctn, wp, dbr] = localJobItems(job({ services: 'WP CTN DBR' }), PLACES, CATALOG)
    expect(ctn).toMatchObject({
      actCode: 'CTN',
      known: true,
      side: 'origin',
      actName: 'Carton Delivery',
    })
    expect(wp).toMatchObject({ actCode: 'WP', known: true, side: 'origin' })
    expect(dbr).toMatchObject({ actCode: 'DBR', known: true, side: 'destination' })
  })

  it('shows a hand-typed token it does not know, sided by the job flags', () => {
    const [mile] = localJobItems(
      job({ services: 'MILE', service_at_orig: 'N', service_at_dest: 'Y' }),
      PLACES,
      CATALOG,
    )
    expect(mile).toMatchObject({
      actCode: 'MILE',
      actName: 'MILE',
      known: false,
      side: 'destination',
    })
  })

  it('still gives the driver a day of work when services is empty', () => {
    const items = localJobItems(job({ services: '' }), PLACES, CATALOG)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'local-job-token:7001:-',
      actCode: null,
      actName: 'Local job',
      source: { kind: 'local-job-token', jobId: 7001, token: null },
    })
  })

  it('reads the service date as the day, and as the actual once the job is final', () => {
    const [open] = localJobItems(job({ services: 'PACK' }), PLACES, CATALOG)
    expect(open).toMatchObject({ day: '2026-10-20', plannedStart: '2026-10-20', actual: null })
    const [done] = localJobItems(job({ services: 'PACK', is_final: 'Y' }), PLACES, CATALOG)
    expect(done?.actual).toBe('2026-10-20')
  })

  it('carries the ETA window as wall-clock times with no zone', () => {
    const [i] = localJobItems(
      job({ eta_minimum: '2026-10-20T08:00:00.000Z', eta_maximum: '2026-10-20T10:30:00.000Z' }),
      PLACES,
      CATALOG,
    )
    expect(i?.arrivalWindow).toEqual({ start: '08:00', end: '10:30', tz: null })
  })

  // Legacy stores every job time on 1900-01-01; "not set" is midnight, never NULL.
  const T = (hhmm: string) => `1900-01-01T${hhmm}:00.000Z`

  it('prefers a set ETA over the crew start time', () => {
    const [i] = localJobItems(
      job({
        eta_minimum: T('10:00'),
        eta_maximum: T('12:00'),
        start_time: T('08:00'),
        end_time: T('08:00'),
      }),
      PLACES,
      CATALOG,
    )
    expect(i?.arrivalWindow).toEqual({ start: '10:00', end: '12:00', tz: null })
  })

  it('treats a midnight ETA as unset and falls back to the crew start time', () => {
    // NW live check 2026-10-28: eta 00:00–01:00 is "no ETA", not a window.
    const [single] = localJobItems(
      job({
        eta_minimum: T('00:00'),
        eta_maximum: T('01:00'),
        start_time: T('09:00'),
        end_time: T('09:00'),
      }),
      PLACES,
      CATALOG,
    )
    expect(single?.arrivalWindow).toEqual({ start: '09:00', end: '09:00', tz: null })

    const [range] = localJobItems(
      job({
        eta_minimum: T('00:00'),
        eta_maximum: T('01:00'),
        start_time: T('07:00'),
        end_time: T('09:30'),
      }),
      PLACES,
      CATALOG,
    )
    expect(range?.arrivalWindow).toEqual({ start: '07:00', end: '09:30', tz: null })
  })

  it('never ends a window before it starts, and has none when both times are unset', () => {
    const [backwards] = localJobItems(
      job({ start_time: T('09:00'), end_time: T('08:00') }),
      PLACES,
      CATALOG,
    )
    expect(backwards?.arrivalWindow).toEqual({ start: '09:00', end: '09:00', tz: null })

    const [none] = localJobItems(
      job({
        eta_minimum: T('00:00'),
        eta_maximum: T('01:00'),
        start_time: T('00:00'),
        end_time: T('00:00'),
      }),
      PLACES,
      CATALOG,
    )
    expect(none?.arrivalWindow).toBeNull()
  })

  it('lists both driver slots in the crew numbering space, never the longhaul one', () => {
    const [i] = localJobItems(job({ driver_id1: 412, driver_id2: 77 }), PLACES, CATALOG)
    expect(i?.drivers).toEqual({ longhaul: [], local: [412, 77] })
    expect(i?.tripId).toBeNull()
  })

  it('keeps the dispatcher free text as a note, unparsed', () => {
    const [i] = localJobItems(
      job({ services: 'LOAD', OriginLocation1: 'DMS WHSE 7441 N HAGGERTY RD CANTON, MI 48187' }),
      PLACES,
      CATALOG,
    )
    expect(i?.placeNote).toBe('DMS WHSE 7441 N HAGGERTY RD CANTON, MI 48187')
  })

  it('returns nothing for an inactive job or one with no service date', () => {
    expect(localJobItems(job({ active: 'N' }), PLACES, CATALOG)).toEqual([])
    expect(localJobItems(job({ service_date: null }), PLACES, CATALOG)).toEqual([])
  })

  it('tolerates an order it could not find', () => {
    const [i] = localJobItems(job({ services: 'PACK' }), null, CATALOG)
    expect(i).toMatchObject({ place: null, shipperName: null })
  })
})
