// Each tool's request path and projection, against canned endpoint bodies.
// The projection is what the model actually reads, so its shape is the contract.

import { describe, it, expect } from 'vitest'
import { getTrip } from './get-trip'
import { searchTrips } from './search-trips'
import { searchShipments } from './search-shipments'
import { listCustomers, listInvoices, listMoves, listQuotes } from './entity-lists'
import { MAX_ROWS, pick, place, range } from './shared'
import type { ToolProjection } from './types'

/** None of these projections read their input; pass an empty one. */
const proj = (t: { project(body: unknown, input: never): ToolProjection }, body: unknown) =>
  t.project(body, {} as never)

const filtersOf = (path: string) =>
  JSON.parse(decodeURIComponent(path.split('filters=')[1]!)) as Record<string, unknown>

describe('search_trips', () => {
  it('builds trip, driver and planned-date filters, sorted by first day', () => {
    const path = searchTrips.request(
      searchTrips.input.parse({ trip_id: 4471, driver_id: 7, planned_from: '2026-11-01' }),
    )
    expect(path.startsWith('/api/v1/onprem/longhaul/trips?filters=')).toBe(true)
    expect(filtersOf(path)).toEqual({
      filters: { id: '4471', driver_id: { value: 7 }, planned_date: ['2026-11-01', null] },
      sortBy: { value: 'planned_first_day', order: 'ASC' },
    })
  })

  it('sends no filters when given none', () => {
    expect(filtersOf(searchTrips.request(searchTrips.input.parse({})))['filters']).toEqual({})
  })

  it('projects a trip row to the narrow shape', () => {
    const out = proj(searchTrips, {
      data: [
        {
          id: 1,
          trip_title: 'T1',
          status_status: 'Planned',
          driver_name: 'Jo',
          planned_first_day: '2026-11-02T00:00:00.000Z',
          planner_first_name: 'Pat',
          planner_last_name: 'Lee',
          dispatcher_first_name: null,
          notes: [{}, {}],
          secret_column: 'dropped',
        },
      ],
    })
    expect(out.resultCount).toBe(1)
    expect((out.data as { rows: unknown[] }).rows[0]).toEqual({
      id: 1,
      trip_title: 'T1',
      status: 'Planned',
      driver_name: 'Jo',
      planned_first_day: '2026-11-02',
      planner: 'Pat Lee',
      dispatcher: undefined,
      notes: 2,
    })
  })
})

describe('get_trip', () => {
  it('requests the trip detail by number', () => {
    expect(getTrip.request({ trip_id: 12 })).toBe('/api/v1/onprem/longhaul/trips/12')
  })

  it('reports a missing trip as not found', () => {
    expect(proj(getTrip, { data: null })).toEqual({ resultCount: null, data: { found: false } })
  })

  it('caps activities, shipments and notes and flags truncated activities', () => {
    const activities = Array.from({ length: 45 }, (_, i) => ({
      ActivityType_code: 'LD',
      order_num: `O${i}`,
      city: 'Austin',
      state: 'TX',
    }))
    const shipments = Array.from({ length: 25 }, (_, i) => ({
      order_num: `O${i}`,
      shipper_city: 'Austin',
      shipper_state: 'TX',
      consignee_city: '',
      consignee_state: 'CA',
    }))
    const notes = Array.from({ length: 12 }, (_, i) => ({ note: `n${i}` }))
    const out = proj(getTrip, {
      data: { id: 12, status_status: 'Active', activities, shipments, notes },
    })
    const d = out.data as {
      status: string
      activities: Array<{ location?: string }>
      activities_truncated?: boolean
      shipments: Array<{ origin?: string; destination?: string }>
      notes: unknown[]
    }
    expect(out.resultCount).toBe(45)
    expect(d.status).toBe('Active')
    expect(d.activities).toHaveLength(40)
    expect(d.activities[0]!.location).toBe('Austin, TX')
    expect(d.activities_truncated).toBe(true)
    expect(d.shipments).toHaveLength(20)
    expect(d.shipments[0]).toMatchObject({ origin: 'Austin, TX', destination: 'CA' })
    expect(d.notes).toHaveLength(10)
  })

  it('treats non-array children as empty', () => {
    const out = proj(getTrip, { data: { id: 1, activities: 'x' } })
    expect(out.resultCount).toBe(0)
    expect((out.data as { activities_truncated?: boolean }).activities_truncated).toBeUndefined()
  })
})

describe('search_shipments', () => {
  it('uses a free-text search when one is given, ignoring filters', () => {
    expect(searchShipments.request(searchShipments.input.parse({ search: 'smith & co' }))).toBe(
      '/api/v1/onprem/longhaul/shipments?searchTerm=smith%20%26%20co',
    )
  })

  it('builds destination, pack and delivery ranges', () => {
    const path = searchShipments.request(
      searchShipments.input.parse({
        destination_states: ['ca'],
        pack_to: '2026-11-05',
        delivery_from: '2026-11-06',
        assigned: 'yes',
      }),
    )
    expect(filtersOf(path)['filters']).toEqual({
      destination: [{ value: 'CA' }],
      pack_date: [null, '2026-11-05'],
      delivery_date: ['2026-11-06', null],
      assigned: [{ value: 'Yes' }],
    })
  })
})

describe('entity lists', () => {
  it('ask for one page of MAX_ROWS + 1 from the given offset', () => {
    expect(listCustomers.request({})).toBe(`/api/v1/customers?limit=${MAX_ROWS + 1}&offset=0`)
    expect(listQuotes.request({ offset: 40 })).toBe(
      `/api/v1/quotes?limit=${MAX_ROWS + 1}&offset=40`,
    )
    expect(listInvoices.request({})).toContain('/api/v1/invoices?')
    expect(listMoves.request({})).toContain('/api/v1/moves?')
  })

  it('project customers, quotes, invoices and moves', () => {
    const row = (body: unknown) => (proj(listCustomers, body).data as { rows: unknown[] }).rows[0]
    expect(row({ data: [{ id: 'c1', firstName: 'A', email: null, ssn: 'x' }] })).toEqual({
      id: 'c1',
      firstName: 'A',
    })

    const quote = proj(listQuotes, {
      data: [
        { id: 'q1', status: 'SENT', price: { amount: 1234.5, currency: 'USD' } },
        { id: 'q2', price: null },
      ],
    }).data as { rows: Array<{ price?: string }> }
    expect(quote.rows[0]!.price).toBe('1234.50 USD')
    expect(quote.rows[1]!.price).toBeUndefined()

    const inv = proj(listInvoices, {
      data: [{ id: 'i1', total: { amount: 10 }, payments: [{}] }, { id: 'i2' }],
    }).data as { rows: Array<{ total?: string; payments?: number }> }
    expect(inv.rows[0]).toMatchObject({ total: '10.00', payments: 1 })
    expect(inv.rows[1]!.payments).toBeUndefined()

    const moves = proj(listMoves, {
      data: [
        {
          id: 'm1',
          origin: { city: 'Austin', state: 'TX' },
          destination: { state: 'CA' },
        },
        { id: 'm2', origin: null },
      ],
    }).data as { rows: Array<{ origin?: string; destination?: string }> }
    expect(moves.rows[0]).toMatchObject({ origin: 'Austin, TX', destination: 'CA' })
    expect(moves.rows[1]!.origin).toBeUndefined()
  })

  it('a non-envelope body projects to no rows', () => {
    expect(proj(listMoves, 'nope').resultCount).toBe(0)
  })
})

describe('shared helpers', () => {
  it('pick drops blanks, trims midnight timestamps and long strings, keeps Dates as days', () => {
    expect(
      pick(
        {
          a: '',
          b: null,
          c: new Date('2026-11-03T12:00:00Z'),
          d: '2026-11-03T09:30:00Z',
          e: 'x'.repeat(301),
        },
        ['a', 'b', 'c', 'd', 'e'],
      ),
    ).toEqual({ c: '2026-11-03', d: '2026-11-03T09:30:00Z', e: `${'x'.repeat(300)}…` })
    expect(pick(null, ['a'])).toEqual({})
  })

  it('place and range handle partial input', () => {
    expect(place(' ', '')).toBeUndefined()
    expect(place('Austin', null)).toBe('Austin')
    expect(range(undefined, undefined)).toBeUndefined()
  })
})
