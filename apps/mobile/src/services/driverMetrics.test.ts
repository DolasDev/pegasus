import { ApiError } from '@pegasus/api-http'
import { getDriverMetrics } from './driverMetrics'

const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch })),
}))

const data = {
  driverId: 4766,
  asOf: '2026-10-15T12:00:00Z',
  weekStart: '2026-10-12T05:00:00Z',
  trips: { activeShipments: 2, completedThisWeek: 1 },
  financials: {
    runningBalance: 1234.56,
    escrowHeld: 800,
    monthEnd: { year: 2026, month: 9, balance: 1100 },
    pendingSettlement: { total: 2500, count: 2 },
  },
  unavailable: [],
}

describe('getDriverMetrics', () => {
  beforeEach(() => mockFetch.mockReset())

  it('requests /api/v1/me/driver/metrics and returns the data', async () => {
    mockFetch.mockResolvedValue(data)
    await expect(getDriverMetrics()).resolves.toEqual({ status: 'ok', metrics: data })
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/me/driver/metrics')
  })

  it('maps 404 DRIVER_NOT_LINKED to not_linked', async () => {
    mockFetch.mockRejectedValue(new ApiError('not linked', 'DRIVER_NOT_LINKED', 404))
    await expect(getDriverMetrics()).resolves.toEqual({ status: 'not_linked' })
  })

  it('rethrows other API errors (including other 404s)', async () => {
    const err = new ApiError('nope', 'NOT_FOUND', 404)
    mockFetch.mockRejectedValue(err)
    await expect(getDriverMetrics()).rejects.toBe(err)
  })

  it('rethrows network errors', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    await expect(getDriverMetrics()).rejects.toThrow('offline')
  })
})
