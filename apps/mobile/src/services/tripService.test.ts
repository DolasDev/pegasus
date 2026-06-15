import { TripService, isVisibleTrip, isOfferedTrip, OFFERED_STATUS } from './tripService'
import type { LonghaulTrip } from '../types/longhaul'

const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch })),
}))

jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}))

function trip(partial: Partial<LonghaulTrip>): LonghaulTrip {
  return {
    id: 1,
    trip_title: null,
    driver_id: 42,
    driver_name: 'Pat Driver',
    status_status: 'Accepted',
    TripStatus_id: 3,
    internal_status: 'active',
    origin_geo_code: 'TX',
    destination_geo_code: 'CA',
    planned_first_day: '2026-06-01',
    planned_last_day: '2026-06-05',
    actual_first_day: null,
    actual_last_day: null,
    total_estimated_lbs: 1000,
    total_actual_lbs: null,
    total_estimated_linehaul_usd: 500,
    total_days: 4,
    ...partial,
  }
}

describe('trip visibility helpers', () => {
  it('hides pending and canceled trips, keeps the rest', () => {
    expect(isVisibleTrip(trip({ status_status: 'Pending' }))).toBe(false)
    expect(isVisibleTrip(trip({ status_status: 'PENDING' }))).toBe(false)
    expect(isVisibleTrip(trip({ internal_status: 'canceled' }))).toBe(false)
    expect(isVisibleTrip(trip({ status_status: 'Offered' }))).toBe(true)
    expect(isVisibleTrip(trip({ status_status: 'Finalized' }))).toBe(true)
  })

  it('flags offered trips case-insensitively', () => {
    expect(isOfferedTrip(trip({ status_status: 'Offered' }))).toBe(true)
    expect(isOfferedTrip(trip({ status_status: 'offered' }))).toBe(true)
    expect(isOfferedTrip(trip({ status_status: 'Accepted' }))).toBe(false)
    expect(OFFERED_STATUS).toBe('offered')
  })
})

describe('TripService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('getDriverId', () => {
    it('returns the mapped driver id', async () => {
      mockFetch.mockResolvedValueOnce({ longhaulDriverId: 4231 })
      await expect(TripService.getDriverId()).resolves.toBe(4231)
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/me/driver')
    })

    it('returns null when unmapped', async () => {
      mockFetch.mockResolvedValueOnce({ longhaulDriverId: null })
      await expect(TripService.getDriverId()).resolves.toBeNull()
    })
  })

  describe('getMyTrips', () => {
    it('filters by driver_id and excludes pending/canceled', async () => {
      mockFetch.mockResolvedValueOnce([
        trip({ id: 1, status_status: 'Offered' }),
        trip({ id: 2, status_status: 'Pending' }),
        trip({ id: 3, status_status: 'Accepted', internal_status: 'canceled' }),
        trip({ id: 4, status_status: 'Finalized' }),
      ])

      const result = await TripService.getMyTrips(42)

      expect(result.map((t) => t.id)).toEqual([1, 4])
      const calledPath = mockFetch.mock.calls[0][0] as string
      expect(calledPath).toContain('/api/v1/onprem/longhaul/trips?filters=')
      const query = JSON.parse(decodeURIComponent(calledPath.split('filters=')[1]))
      expect(query.filters.driver_id.value).toBe(42)
      expect(query.sortBy).toEqual({ value: 'planned_first_day', order: 'desc' })
    })
  })

  describe('getShipment', () => {
    it('returns the exact order_num match from search results', async () => {
      mockFetch.mockResolvedValueOnce([{ order_num: '999' }, { order_num: '12345' }])
      const result = await TripService.getShipment('12345')
      expect(result).toEqual({ order_num: '12345' })
    })

    it('returns null when no shipment matches', async () => {
      mockFetch.mockResolvedValueOnce([])
      await expect(TripService.getShipment('nope')).resolves.toBeNull()
    })
  })
})
