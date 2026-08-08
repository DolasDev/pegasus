import React from 'react'
import { render, act } from '@testing-library/react-native'
import { TripsProvider, useTrips } from './TripsContext'
import { TripService } from '../services/tripService'
import type { LonghaulTrip } from '../types/longhaul'

jest.mock('../services/tripService', () => ({
  ...jest.requireActual('../services/tripService'),
  TripService: { getDriverId: jest.fn(), getMyTrips: jest.fn() },
}))

const mockGetDriverId = TripService.getDriverId as jest.MockedFunction<
  typeof TripService.getDriverId
>
const mockGetMyTrips = TripService.getMyTrips as jest.MockedFunction<typeof TripService.getMyTrips>

function TestConsumer({
  ctxRef,
}: {
  ctxRef: React.MutableRefObject<ReturnType<typeof useTrips> | null>
}) {
  ctxRef.current = useTrips()
  return null
}

function renderProvider() {
  const ctxRef: React.MutableRefObject<ReturnType<typeof useTrips> | null> = { current: null }
  render(
    <TripsProvider>
      <TestConsumer ctxRef={ctxRef} />
    </TripsProvider>,
  )
  return ctxRef
}

const trip = { id: 1, status_status: 'Offered' } as LonghaulTrip

describe('TripsProvider', () => {
  beforeEach(() => {
    mockGetDriverId.mockReset()
    mockGetMyTrips.mockReset()
  })

  it('loads the driver mapping then the trips', async () => {
    mockGetDriverId.mockResolvedValue(42)
    mockGetMyTrips.mockResolvedValue([trip])

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(mockGetMyTrips).toHaveBeenCalledWith(42)
    expect(ctxRef.current!.driverId).toBe(42)
    expect(ctxRef.current!.trips).toEqual([trip])
    expect(ctxRef.current!.offeredCount).toBe(1)
    expect(ctxRef.current!.error).toBeNull()
    expect(ctxRef.current!.loading).toBe(false)
  })

  it('reports a failed mapping lookup as an error, not as "no driver"', async () => {
    // driverId stays null AND error is set — the pair the trips screen uses to
    // tell a broken request apart from an unmapped account.
    mockGetDriverId.mockRejectedValue(new Error('Unauthorized'))

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(ctxRef.current!.driverId).toBeNull()
    expect(ctxRef.current!.error).toBe('Unauthorized')
    expect(mockGetMyTrips).not.toHaveBeenCalled()
  })

  it('resolves with no driver and no error when the account is genuinely unmapped', async () => {
    mockGetDriverId.mockResolvedValue(null)

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(ctxRef.current!.driverId).toBeNull()
    expect(ctxRef.current!.mappingResolved).toBe(true)
    expect(ctxRef.current!.error).toBeNull()
    expect(mockGetMyTrips).not.toHaveBeenCalled()
  })

  it('refresh() clears a prior error and recovers', async () => {
    mockGetDriverId.mockRejectedValueOnce(new Error('Network request failed'))

    const ctxRef = renderProvider()
    await act(async () => {})
    expect(ctxRef.current!.error).toBe('Network request failed')

    mockGetDriverId.mockResolvedValueOnce(7)
    mockGetMyTrips.mockResolvedValueOnce([trip])
    await act(async () => {
      await ctxRef.current!.refresh()
    })

    expect(ctxRef.current!.error).toBeNull()
    expect(ctxRef.current!.driverId).toBe(7)
    expect(ctxRef.current!.trips).toEqual([trip])
  })
})
