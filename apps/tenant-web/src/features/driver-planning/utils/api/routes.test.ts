import { describe, it, expect } from 'vitest'
import { resolveRoute } from './routes'

describe('resolveRoute', () => {
  describe('reference data GETs', () => {
    it.each([
      ['fetchStates', '/states'],
      ['fetchZones', '/zones'],
      ['fetchDrivers', '/drivers'],
      ['fetchTripStatuses', '/trip-statuses'],
      ['fetchPlanners', '/planners'],
      ['fetchDispatchers', '/dispatchers'],
      ['fetchUser', '/users/me'],
      ['fetchVersion', '/version'],
      ['fetchFilterOptions', '/filter-options'],
    ])('%s → GET %s', (name, path) => {
      expect(resolveRoute(name, [])).toEqual({ method: 'GET', path })
    })
  })

  describe('trips', () => {
    it('fetchTrips with no filters → GET /trips', () => {
      expect(resolveRoute('fetchTrips', [undefined])).toEqual({
        method: 'GET',
        path: '/trips',
      })
    })

    it('fetchTrips with filters → GET /trips?filters=<encoded>', () => {
      const filters = { driverId: 'd1', date: '2026-01-01' }
      const r = resolveRoute('fetchTrips', [filters])
      expect(r.method).toBe('GET')
      expect(r.path).toBe(`/trips?filters=${encodeURIComponent(JSON.stringify(filters))}`)
    })

    it('fetchTrip → GET /trips/:id', () => {
      expect(resolveRoute('fetchTrip', [42])).toEqual({
        method: 'GET',
        path: '/trips/42',
      })
    })

    it('saveTrip without id → POST /trips with body', () => {
      const trip = { driverId: 'd1' }
      expect(resolveRoute('saveTrip', [trip])).toEqual({
        method: 'POST',
        path: '/trips',
        body: trip,
      })
    })

    it('saveTrip with id → PUT /trips/:id with body', () => {
      const trip = { id: 7, driverId: 'd1' }
      expect(resolveRoute('saveTrip', [trip])).toEqual({
        method: 'PUT',
        path: '/trips/7',
        body: trip,
      })
    })

    it('cancelTrip → POST /trips/:id/cancel', () => {
      expect(resolveRoute('cancelTrip', ['abc'])).toEqual({
        method: 'POST',
        path: '/trips/abc/cancel',
      })
    })

    it('changeTripStatus → PATCH /trips/:tripId/status with body', () => {
      const arg = { tripId: 't1', statusId: 3, status: 'EN_ROUTE' }
      expect(resolveRoute('changeTripStatus', [arg])).toEqual({
        method: 'PATCH',
        path: '/trips/t1/status',
        body: { statusId: 3, status: 'EN_ROUTE' },
      })
    })

    it('updateTripSummaryInfo → PATCH /trips/:id/summary with empty body', () => {
      expect(resolveRoute('updateTripSummaryInfo', [9])).toEqual({
        method: 'PATCH',
        path: '/trips/9/summary',
        body: {},
      })
    })

    it('createTripNote → POST /trips/:tripId/notes with note+createdBy', () => {
      const arg = { tripId: 't9', createdBy: 'u1', note: 'hello' }
      expect(resolveRoute('createTripNote', [arg])).toEqual({
        method: 'POST',
        path: '/trips/t9/notes',
        body: { note: 'hello', createdBy: 'u1' },
      })
    })

    it('patchTripNote → PATCH /notes/:id with note+tripId', () => {
      const arg = { id: 'n1', tripId: 't1', note: 'edited' }
      expect(resolveRoute('patchTripNote', [arg])).toEqual({
        method: 'PATCH',
        path: '/notes/n1',
        body: { note: 'edited', tripId: 't1' },
      })
    })
  })

  describe('shipments', () => {
    it('fetchShipments with no args → GET /shipments', () => {
      expect(resolveRoute('fetchShipments', [])).toEqual({
        method: 'GET',
        path: '/shipments',
      })
    })

    it('fetchShipments with empty object → GET /shipments', () => {
      expect(resolveRoute('fetchShipments', [{}])).toEqual({
        method: 'GET',
        path: '/shipments',
      })
    })

    it('fetchShipments with only filters → GET /shipments?filters=<encoded>', () => {
      const r = resolveRoute('fetchShipments', [{ status: 'OPEN' }])
      expect(r.method).toBe('GET')
      expect(r.path).toBe(
        `/shipments?filters=${encodeURIComponent(JSON.stringify({ status: 'OPEN' }))}`,
      )
    })

    it('fetchShipments with searchTerm only → GET /shipments?searchTerm=…', () => {
      const r = resolveRoute('fetchShipments', [{ searchTerm: 'acme corp' }])
      expect(r.method).toBe('GET')
      expect(r.path).toBe(`/shipments?searchTerm=${encodeURIComponent('acme corp')}`)
    })

    it('fetchShipments with filters AND searchTerm → both query parts', () => {
      const r = resolveRoute('fetchShipments', [{ searchTerm: 'foo', status: 'OPEN' }])
      expect(r.method).toBe('GET')
      expect(r.path).toBe(
        `/shipments?filters=${encodeURIComponent(JSON.stringify({ status: 'OPEN' }))}&searchTerm=${encodeURIComponent('foo')}`,
      )
    })

    it('saveShipmentCoverage → POST /shipments/:order_num/coverage', () => {
      const dto = { order_num: 1234, coverage: 'FULL' }
      expect(resolveRoute('saveShipmentCoverage', [dto])).toEqual({
        method: 'POST',
        path: '/shipments/1234/coverage',
        body: dto,
      })
    })

    it('saveShipmentCoverage falls back to /shipments/0/coverage if order_num missing', () => {
      const dto = { coverage: 'FULL' }
      expect(resolveRoute('saveShipmentCoverage', [dto])).toEqual({
        method: 'POST',
        path: '/shipments/0/coverage',
        body: dto,
      })
    })

    it('patchShipmentShadow → PATCH /shipments/:order_num/shadow', () => {
      const dto = { order_num: 99, shadow: true }
      expect(resolveRoute('patchShipmentShadow', [dto])).toEqual({
        method: 'PATCH',
        path: '/shipments/99/shadow',
        body: dto,
      })
    })

    it('patchShipmentShadow falls back to /shipments/0/shadow if order_num missing', () => {
      expect(resolveRoute('patchShipmentShadow', [{}])).toEqual({
        method: 'PATCH',
        path: '/shipments/0/shadow',
        body: {},
      })
    })
  })

  describe('activities', () => {
    it('saveActivity → POST /activities/:activityId with activityData', () => {
      const arg = { activityId: 'a1', activityData: { foo: 'bar' } }
      expect(resolveRoute('saveActivity', [arg])).toEqual({
        method: 'POST',
        path: '/activities/a1',
        body: { foo: 'bar' },
      })
    })
  })

  describe('shipment filters', () => {
    it('fetchSavedShipmentFilters → GET /shipment-filters', () => {
      expect(resolveRoute('fetchSavedShipmentFilters', [])).toEqual({
        method: 'GET',
        path: '/shipment-filters',
      })
    })

    it('fetchShipmentDefaultFilterForUser → GET /shipment-filters/default', () => {
      expect(resolveRoute('fetchShipmentDefaultFilterForUser', [])).toEqual({
        method: 'GET',
        path: '/shipment-filters/default',
      })
    })

    it('saveShipmentsFilter → POST /shipment-filters with body', () => {
      const payload = { name: 'mine', filters: {} }
      expect(resolveRoute('saveShipmentsFilter', [payload])).toEqual({
        method: 'POST',
        path: '/shipment-filters',
        body: payload,
      })
    })

    it('setDefaultShipmentFilter → PUT /shipment-filters/default with { filter_id }', () => {
      expect(resolveRoute('setDefaultShipmentFilter', [55])).toEqual({
        method: 'PUT',
        path: '/shipment-filters/default',
        body: { filter_id: 55 },
      })
    })

    it('deleteShipmentFilter → DELETE /shipment-filters/:id', () => {
      expect(resolveRoute('deleteShipmentFilter', [55])).toEqual({
        method: 'DELETE',
        path: '/shipment-filters/55',
      })
    })
  })

  describe('errors', () => {
    it('throws for unknown route', () => {
      expect(() => resolveRoute('definitelyNotARoute', [])).toThrow(
        /Unknown longhaul route: definitelyNotARoute/,
      )
    })

    // jump-to-order is no longer a proxied HTTP route — it launches the desktop
    // app via a custom URI scheme (see utils/jump-to-order.ts).
    it('no longer resolves the removed pegasusRemoteFunctionCall route', () => {
      expect(() => resolveRoute('pegasusRemoteFunctionCall', [])).toThrow(/Unknown longhaul route/)
    })
  })
})
