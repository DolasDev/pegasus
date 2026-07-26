import React from 'react'
import { render } from '@testing-library/react-native'
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
})
