import React from 'react'
import { render, waitFor } from '@testing-library/react-native'
import DashboardScreen from '../../../app/(drawer)/index'
import { getDriverMetrics } from '../../services/driverMetrics'

jest.mock('../../services/driverMetrics')
jest.mock('../../utils/logger')

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
    ;(getDriverMetrics as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockMetrics), 1000)),
    )

    const { getByText } = render(<DashboardScreen />)
    expect(getByText('Loading dashboard…')).toBeTruthy()
  })
})
