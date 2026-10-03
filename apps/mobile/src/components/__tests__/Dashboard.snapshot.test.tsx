import React from 'react'
import { render, waitFor } from '@testing-library/react-native'
import DashboardScreen from '../../../app/(drawer)/index'
import { getDriverMetrics } from '../../services/driverMetrics'

jest.mock('../../services/driverMetrics')
jest.mock('../../utils/logger')
jest.mock('../../context/TripsContext', () => ({
  useTrips: () => ({ offeredCount: 0, refresh: jest.fn() }),
}))

const mockMetrics = {
  accountBalance: 1234.56,
  activeShipments: 4,
  pendingSettlementTotal: 500,
  completedThisWeek: 6,
  milesThisWeek: 980,
}

describe('Driver Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDriverMetrics as jest.Mock).mockResolvedValue(mockMetrics)
  })

  it('renders metric tiles after loading', async () => {
    const { getByText } = render(<DashboardScreen />)

    await waitFor(() => {
      expect(getByText('Account Balance')).toBeTruthy()
    })

    expect(getByText('$1,234.56')).toBeTruthy()
    expect(getByText('Active Shipments')).toBeTruthy()
    expect(getByText('4')).toBeTruthy()
    expect(getByText('Pending Settlement')).toBeTruthy()
    expect(getByText('$500.00')).toBeTruthy()
    expect(getByText('Completed (wk)')).toBeTruthy()
    expect(getByText('Miles (wk)')).toBeTruthy()
    expect(getByText('980')).toBeTruthy()
  })

  it('shows loading state initially', () => {
    // A promise that never settles is all this assertion needs: the screen stays in
    // its loading branch and nothing is left behind. The previous mock resolved via
    // `setTimeout(…, 1000)`, and because the test asserts synchronously and returns,
    // that real timer outlived it — `jest --detectOpenHandles` named it as the ONE
    // open handle in the whole apps/mobile suite, reproducibly. `jest --forceExit`
    // (the package's `test` script) then killed the worker instead of failing, which
    // is the "A worker process has failed to exit gracefully" line CI reported on
    // 2026-10-01. Never resolve a loading-state mock on a real timer.
    ;(getDriverMetrics as jest.Mock).mockImplementation(() => new Promise<never>(() => {}))

    const { getByText } = render(<DashboardScreen />)
    expect(getByText('Loading dashboard…')).toBeTruthy()
  })
})
