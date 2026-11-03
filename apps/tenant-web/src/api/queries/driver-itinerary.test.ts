import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
  apiFetchPaginated: vi.fn(),
}))

import { apiFetch, apiFetchPaginated } from '@/api/client'
import {
  driverItineraryPath,
  driverItineraryQueryOptions,
  itineraryCrewsQueryOptions,
} from './driver-itinerary'

const mockedFetch = apiFetch as unknown as ReturnType<typeof vi.fn>
const mockedPaginated = apiFetchPaginated as unknown as ReturnType<typeof vi.fn>

const RANGE = { from: '2026-11-02', to: '2026-11-08' }

beforeEach(() => {
  mockedFetch.mockReset()
  mockedPaginated.mockReset()
})

describe('driverItineraryPath', () => {
  it('sends each picked id in its own parameter, and never an unpicked one', () => {
    expect(
      driverItineraryPath({ ...RANGE, longhaulDriverId: 134, localDriverEmployeeId: 3097 }),
    ).toBe(
      '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-02&to=2026-11-08&longhaulDriverId=134&localDriverEmployeeId=3097',
    )
    expect(
      driverItineraryPath({ ...RANGE, longhaulDriverId: null, localDriverEmployeeId: 3097 }),
    ).toBe(
      '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-02&to=2026-11-08&localDriverEmployeeId=3097',
    )
  })
})

describe('driverItineraryQueryOptions', () => {
  it('keeps the items and the failed sources', async () => {
    mockedPaginated.mockResolvedValue({
      data: [{ key: 'order-assigned:1:RDEL' }],
      meta: { count: 1, from: RANGE.from, to: RANGE.to, failedSources: ['local'] },
    })
    const q = { ...RANGE, longhaulDriverId: 134, localDriverEmployeeId: null }
    const data = await new QueryClient().fetchQuery(driverItineraryQueryOptions(q))
    expect(data).toEqual({ items: [{ key: 'order-assigned:1:RDEL' }], failedSources: ['local'] })
  })

  it('is disabled until a driver or crew is picked', () => {
    const opts = driverItineraryQueryOptions({
      ...RANGE,
      longhaulDriverId: null,
      localDriverEmployeeId: null,
    })
    expect(opts.enabled).toBe(false)
  })
})

describe('itineraryCrewsQueryOptions', () => {
  it('reads the Operations crew list, not the admin-only one', async () => {
    mockedFetch.mockResolvedValue([{ employeeId: 3097, name: 'Sherwood, Benjamin' }])
    await new QueryClient().fetchQuery(itineraryCrewsQueryOptions)
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/local-drivers')
  })
})
