import React from 'react'
import { render, act } from '@testing-library/react-native'
import { TripsProvider, useTrips } from './TripsContext'
import { TripService } from '../services/tripService'
import type { LonghaulTrip } from '../types/longhaul'

jest.mock('../services/tripService', () => ({
  ...jest.requireActual('../services/tripService'),
  TripService: { getDriverMapping: jest.fn(), getMyTrips: jest.fn() },
}))

const mockGetDriverMapping = TripService.getDriverMapping as jest.MockedFunction<
  typeof TripService.getDriverMapping
>
/** /me/driver's answer with only a longhaul id (or none). */
const ids = (longhaulDriverId: number | null) => ({
  longhaulDriverId,
  localDriverEmployeeId: null,
  driverEtaEnabled: true,
})
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
    mockGetDriverMapping.mockReset()
    mockGetMyTrips.mockReset()
  })

  it('loads the driver mapping then the trips', async () => {
    mockGetDriverMapping.mockResolvedValue(ids(42))
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

  it('exposes a local-only crew id without fetching trips (a local job has none)', async () => {
    mockGetDriverMapping.mockResolvedValue({
      longhaulDriverId: null,
      localDriverEmployeeId: 3097,
      driverEtaEnabled: true,
    })

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(ctxRef.current!.driverId).toBeNull()
    expect(ctxRef.current!.localDriverId).toBe(3097)
    expect(mockGetMyTrips).not.toHaveBeenCalled()
    expect(ctxRef.current!.trips).toEqual([])
  })

  it("exposes the tenant's driver ETA opt-in from the mapping", async () => {
    mockGetDriverMapping.mockResolvedValue({ ...ids(42), driverEtaEnabled: false })
    mockGetMyTrips.mockResolvedValue([])

    const ctxRef = renderProvider()
    expect(ctxRef.current!.driverEtaEnabled).toBe(false)
    await act(async () => {})
    expect(ctxRef.current!.driverEtaEnabled).toBe(false)

    mockGetDriverMapping.mockResolvedValue(ids(42))
    await act(async () => {
      await ctxRef.current!.refresh()
    })
    expect(ctxRef.current!.driverEtaEnabled).toBe(true)
  })

  it('keeps driver ETAs off when the mapping lookup fails', async () => {
    mockGetDriverMapping.mockRejectedValue(new Error('Unauthorized'))
    const ctxRef = renderProvider()
    await act(async () => {})
    expect(ctxRef.current!.driverEtaEnabled).toBe(false)
  })

  it('reports a failed mapping lookup as an error, not as "no driver"', async () => {
    // driverId stays null AND error is set — the pair the trips screen uses to
    // tell a broken request apart from an unmapped account.
    mockGetDriverMapping.mockRejectedValue(new Error('Unauthorized'))

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(ctxRef.current!.driverId).toBeNull()
    expect(ctxRef.current!.error).toBe('Unauthorized')
    expect(mockGetMyTrips).not.toHaveBeenCalled()
  })

  it('resolves with no driver and no error when the account is genuinely unmapped', async () => {
    mockGetDriverMapping.mockResolvedValue(ids(null))

    const ctxRef = renderProvider()
    await act(async () => {})

    expect(ctxRef.current!.driverId).toBeNull()
    expect(ctxRef.current!.mappingResolved).toBe(true)
    expect(ctxRef.current!.error).toBeNull()
    expect(mockGetMyTrips).not.toHaveBeenCalled()
  })

  it('refresh() clears a prior error and recovers', async () => {
    mockGetDriverMapping.mockRejectedValueOnce(new Error('Network request failed'))

    const ctxRef = renderProvider()
    await act(async () => {})
    expect(ctxRef.current!.error).toBe('Network request failed')

    mockGetDriverMapping.mockResolvedValueOnce(ids(7))
    mockGetMyTrips.mockResolvedValueOnce([trip])
    await act(async () => {
      await ctxRef.current!.refresh()
    })

    expect(ctxRef.current!.error).toBeNull()
    expect(ctxRef.current!.driverId).toBe(7)
    expect(ctxRef.current!.trips).toEqual([trip])
  })
})
