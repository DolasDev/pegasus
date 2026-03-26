import React from 'react'
import { render } from '@testing-library/react-native'
import DashboardScreen from '../../../app/(tabs)/index'
import { OrderService } from '../../services/orderService'
import { MOCK_ORDERS } from '../../services/mockData'

jest.mock('../../services/orderService')
jest.mock('../../utils/logger')

describe('Dashboard Snapshot Test (Trucker Mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(OrderService.getOrders as jest.Mock).mockResolvedValue(MOCK_ORDERS)
  })

  it('should render orders with correct structure', async () => {
    const { findByText, getByText, getAllByText } = render(<DashboardScreen />)

    // Wait for orders to load
    await findByText('#12345')

    // Verify key elements are present
    expect(getByText('#12345')).toBeTruthy()
    expect(getByText('John Anderson')).toBeTruthy()
    expect(getAllByText('PENDING').length).toBeGreaterThan(0)
  })

  it('should render empty state correctly', async () => {
    ;(OrderService.getOrders as jest.Mock).mockResolvedValue([])

    const { findByText, getByText } = render(<DashboardScreen />)

    // Wait for empty message
    await findByText('No orders assigned')

    expect(getByText('No orders assigned')).toBeTruthy()
    expect(getByText('Pull down to refresh')).toBeTruthy()
  })

  it('should show loading state', () => {
    // Mock a delayed response
    ;(OrderService.getOrders as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MOCK_ORDERS), 1000)),
    )

    const { getByText } = render(<DashboardScreen />)

    expect(getByText('Loading orders...')).toBeTruthy()
  })

  it('should render multiple status badges', async () => {
    const mixedStatusOrders = [
      { ...MOCK_ORDERS[0], status: 'pending' as const },
      { ...MOCK_ORDERS[1], status: 'in_transit' as const },
      { ...MOCK_ORDERS[2], status: 'delivered' as const },
    ]

    ;(OrderService.getOrders as jest.Mock).mockResolvedValue(mixedStatusOrders)

    const { findByText, getByText } = render(<DashboardScreen />)

    await findByText('PENDING')

    expect(getByText('PENDING')).toBeTruthy()
    expect(getByText('IN TRANSIT')).toBeTruthy()
    expect(getByText('DELIVERED')).toBeTruthy()
  })
})
