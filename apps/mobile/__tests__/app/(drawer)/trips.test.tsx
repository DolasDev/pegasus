import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import TripsScreen from '../../../app/(drawer)/trips'

// useTrips is the only real dependency of the driver-mapping states we assert.
const mockUseTrips = jest.fn()
jest.mock('../../../src/context/TripsContext', () => ({
  useTrips: () => mockUseTrips(),
}))

const base = {
  trips: [],
  loading: false,
  mappingResolved: true,
  driverId: null as number | null,
  offeredCount: 0,
  error: null as string | null,
  refresh: jest.fn(),
}

describe('TripsScreen driver-mapping states', () => {
  it('shows an error state — not "No driver linked" — when the mapping lookup failed', () => {
    // Regression: a thrown /me/driver request used to be masked as "No driver linked".
    mockUseTrips.mockReturnValue({ ...base, driverId: null, error: 'Network request failed' })
    const { getByText, queryByText } = render(<TripsScreen />)
    expect(getByText('Couldn’t load your driver')).toBeTruthy()
    expect(getByText('Network request failed')).toBeTruthy()
    expect(queryByText('No driver linked')).toBeNull()
  })

  it('shows "No driver linked" only when resolved with no driver and no error', () => {
    mockUseTrips.mockReturnValue({ ...base, driverId: null, error: null })
    const { getByText, queryByText } = render(<TripsScreen />)
    expect(getByText('No driver linked')).toBeTruthy()
    expect(queryByText('Couldn’t load your driver')).toBeNull()
  })

  it('shows the loading state — not an empty state — while a load is in flight', () => {
    // Regression: Retry routed through the pull-to-refresh path, which skipped
    // the spinner, so the in-flight retry rendered whichever empty state matched
    // the stale data — refresh() clears `error` but not `driverId`, so retrying
    // an error flashed the "No driver linked" onboarding copy.
    mockUseTrips.mockReturnValue({ ...base, loading: true, driverId: null, error: null })
    const { getByText, queryByText } = render(<TripsScreen />)
    expect(getByText('Loading your trips…')).toBeTruthy()
    expect(queryByText('No driver linked')).toBeNull()
    expect(queryByText('Couldn’t load your driver')).toBeNull()
  })

  it('pressing Retry shows the spinner, never the "No driver linked" copy', () => {
    // The reported sequence: error → tap Retry → "No driver linked" flashes →
    // trips appear. Retry used to route through the pull-to-refresh handler,
    // which set isRefreshing and so suppressed the spinner for the whole
    // in-flight request.
    const refresh = jest.fn().mockReturnValue(new Promise(() => {})) // stays in flight
    mockUseTrips.mockReturnValue({
      ...base,
      driverId: null,
      error: 'Network request failed',
      refresh,
    })
    const { getByText, queryByText, rerender } = render(<TripsScreen />)

    fireEvent.press(getByText('Retry'))
    expect(refresh).toHaveBeenCalledTimes(1)

    // The load is now in flight: the context re-renders with the error cleared
    // but driverId still null.
    mockUseTrips.mockReturnValue({ ...base, loading: true, driverId: null, error: null, refresh })
    rerender(<TripsScreen />)

    expect(getByText('Loading your trips…')).toBeTruthy()
    expect(queryByText('No driver linked')).toBeNull()
  })
})
