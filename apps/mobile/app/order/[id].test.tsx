import React from 'react'
import { render, fireEvent, act } from '@testing-library/react-native'
import { Alert, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import OrderDetailScreen from './[id]'
import { OrderService } from '../../src/services/orderService'
import { type TruckingOrder } from '../../src/types'

jest.mock('../../src/services/orderService')

const MockedOrderService = OrderService as jest.Mocked<typeof OrderService>

function makeOrder(overrides: Partial<TruckingOrder> = {}): TruckingOrder {
  return {
    orderId: 'ORD-TEST-001',
    orderNumber: '#TEST-001',
    status: 'pending',
    assignedDriverId: 'DRV-001',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    customer: {
      name: 'Alice Smith',
      phone: '(555) 000-1111',
      email: 'alice@example.com',
    },
    pickup: {
      address: '1 Pickup St',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
      scheduledDate: '2025-01-10T09:00:00Z',
    },
    dropoff: {
      address: '2 Dropoff Ave',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94102',
      scheduledDate: '2025-01-10T15:00:00Z',
    },
    inventory: [
      { id: 'INV-A', description: 'Sofa', quantity: 1, fragile: false },
      { id: 'INV-B', description: 'Glass Vase', quantity: 2, fragile: true },
    ],
    ...overrides,
  }
}

describe('OrderDetailScreen', () => {
  // Captured in beforeEach so all tests share the same mock reference.
  let routerBack: jest.Mock

  beforeEach(() => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'ORD-TEST-001' })
    routerBack = jest.fn()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      back: routerBack,
    })
    MockedOrderService.getOrderById.mockResolvedValue(makeOrder())
    MockedOrderService.updateOrderStatus.mockResolvedValue(true)
    MockedOrderService.addProofPhoto.mockResolvedValue(true)
  })

  describe('loading state', () => {
    it('shows ActivityIndicator while fetching', () => {
      MockedOrderService.getOrderById.mockReturnValue(new Promise(() => {}))

      const { UNSAFE_getByType } = render(<OrderDetailScreen />)
      expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
    })
  })

  describe('order not found', () => {
    it('shows "Order not found" when getOrderById returns null', async () => {
      MockedOrderService.getOrderById.mockResolvedValueOnce(null)

      const { findByText } = render(<OrderDetailScreen />)

      expect(await findByText('Order not found')).toBeTruthy()
    })

    it('"Go Back" button calls router.back() when order not found', async () => {
      MockedOrderService.getOrderById.mockResolvedValueOnce(null)

      const { findByText } = render(<OrderDetailScreen />)
      const goBack = await findByText('Go Back')

      fireEvent.press(goBack)
      expect(routerBack).toHaveBeenCalled()
    })
  })

  describe('order loaded', () => {
    // Always sets up its own mock so the helper is explicit and self-contained.
    async function renderLoaded(overrides?: Partial<TruckingOrder>) {
      MockedOrderService.getOrderById.mockResolvedValueOnce(makeOrder(overrides))
      const utils = render(<OrderDetailScreen />)
      await act(async () => {})
      return utils
    }

    it('renders order number after load', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('#TEST-001')).toBeTruthy()
    })

    it('renders customer name after load', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('Alice Smith')).toBeTruthy()
    })

    it('renders customer phone after load', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('(555) 000-1111')).toBeTruthy()
    })

    it('renders "PICKUP LOCATION" section', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('PICKUP LOCATION')).toBeTruthy()
    })

    it('renders "DROPOFF LOCATION" section', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('DROPOFF LOCATION')).toBeTruthy()
    })

    it('renders inventory item descriptions and quantities', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('Sofa')).toBeTruthy()
      expect(getByText('Glass Vase')).toBeTruthy()
      expect(getByText('Qty: 1')).toBeTruthy()
      expect(getByText('Qty: 2')).toBeTruthy()
    })

    it('renders FRAGILE tag for fragile items', async () => {
      const { getAllByText } = await renderLoaded()
      expect(getAllByText('FRAGILE').length).toBeGreaterThan(0)
    })

    it('shows "No photos captured yet" when no proof photos', async () => {
      const { getByText } = await renderLoaded()
      expect(getByText('No photos captured yet')).toBeTruthy()
    })

    it('shows "START DELIVERY" button for pending orders', async () => {
      const { getByText } = await renderLoaded({ status: 'pending' })
      expect(getByText('START DELIVERY')).toBeTruthy()
    })

    it('shows "MARK AS DELIVERED" button for in_transit orders', async () => {
      const { getByText } = await renderLoaded({ status: 'in_transit' })
      expect(getByText('MARK AS DELIVERED')).toBeTruthy()
    })

    it('shows no status button for delivered orders', async () => {
      const { queryByText } = await renderLoaded({
        status: 'delivered',
        proofOfDelivery: { photos: [], deliveredAt: '2025-01-10T15:00:00Z' },
      })
      expect(queryByText('START DELIVERY')).toBeNull()
      expect(queryByText('MARK AS DELIVERED')).toBeNull()
    })

    it('shows no status button for cancelled orders', async () => {
      const { queryByText } = await renderLoaded({ status: 'cancelled' })
      expect(queryByText('START DELIVERY')).toBeNull()
      expect(queryByText('MARK AS DELIVERED')).toBeNull()
    })

    it('pressing "MARK AS DELIVERED" without photos shows Alert about proof required', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert')
      const { getByText } = await renderLoaded({ status: 'in_transit' })

      await act(async () => {
        fireEvent.press(getByText('MARK AS DELIVERED'))
      })

      expect(alertSpy).toHaveBeenCalledWith(
        'Proof of Delivery Required',
        expect.stringContaining('photo'),
        expect.any(Array),
      )
    })

    it('calls getOrderById with id from useLocalSearchParams', async () => {
      ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'order-1' })
      MockedOrderService.getOrderById.mockResolvedValueOnce(null)

      render(<OrderDetailScreen />)
      await act(async () => {})

      expect(MockedOrderService.getOrderById).toHaveBeenCalledWith('order-1')
    })
  })
})
