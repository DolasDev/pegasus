import AsyncStorage from '@react-native-async-storage/async-storage'
import { OrderService } from './orderService'
import { MOCK_ORDERS } from './__fixtures__/mockData'

// Mock the API client module
const mockFetch = jest.fn()
const mockFetchPaginated = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({
    fetch: mockFetch,
    fetchPaginated: mockFetchPaginated,
  })),
}))

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    logOrderLoad: jest.fn(),
    logOrderStatusChange: jest.fn(),
    logCameraCapture: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}))

describe('OrderService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getOrders', () => {
    it('fetches orders from API and caches them', async () => {
      mockFetchPaginated.mockResolvedValueOnce({
        data: MOCK_ORDERS,
        meta: { total: MOCK_ORDERS.length, count: MOCK_ORDERS.length, limit: 25, offset: 0 },
      })

      const result = await OrderService.getOrders()

      expect(result).toEqual(MOCK_ORDERS)
      expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/moves')
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@moving_app_orders',
        JSON.stringify(MOCK_ORDERS),
      )
    })

    it('falls back to AsyncStorage cache when API fails (offline)', async () => {
      mockFetchPaginated.mockRejectedValueOnce(new Error('Network error'))
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(MOCK_ORDERS))

      const result = await OrderService.getOrders()

      expect(result).toEqual(MOCK_ORDERS)
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('@moving_app_orders')
    })

    it('returns empty array when both API and cache fail', async () => {
      mockFetchPaginated.mockRejectedValueOnce(new Error('Network error'))
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null)

      const result = await OrderService.getOrders()

      expect(result).toEqual([])
    })
  })

  describe('getOrderById', () => {
    it('fetches a single order from API', async () => {
      mockFetch.mockResolvedValueOnce(MOCK_ORDERS[0])

      const result = await OrderService.getOrderById(MOCK_ORDERS[0].orderId)

      expect(result).toEqual(MOCK_ORDERS[0])
      expect(mockFetch).toHaveBeenCalledWith(`/api/v1/moves/${MOCK_ORDERS[0].orderId}`)
    })

    it('falls back to cache when API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(MOCK_ORDERS))

      const result = await OrderService.getOrderById(MOCK_ORDERS[0].orderId)

      expect(result).toEqual(MOCK_ORDERS[0])
    })

    it('returns null when order not found in cache', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(MOCK_ORDERS))

      const result = await OrderService.getOrderById('NON_EXISTENT_ID')

      expect(result).toBeNull()
    })
  })

  describe('updateOrderStatus', () => {
    it('sends status update to API and returns true on success', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(MOCK_ORDERS))

      const result = await OrderService.updateOrderStatus(MOCK_ORDERS[0].orderId, 'in_transit')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(`/api/v1/moves/${MOCK_ORDERS[0].orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_transit', proofPhotos: undefined }),
      })
    })

    it('returns false when API call fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await OrderService.updateOrderStatus(MOCK_ORDERS[0].orderId, 'in_transit')

      expect(result).toBe(false)
    })

    it('updates cached order with proof of delivery when status is delivered', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      const inTransitOrder = {
        ...MOCK_ORDERS[0],
        status: 'in_transit' as const,
        pickup: { ...MOCK_ORDERS[0].pickup, actualDate: new Date().toISOString() },
      }
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([inTransitOrder]))

      const result = await OrderService.updateOrderStatus(inTransitOrder.orderId, 'delivered', [
        'photo1.jpg',
      ])

      expect(result).toBe(true)
      const savedData = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1]
      const savedOrders = JSON.parse(savedData)
      expect(savedOrders[0].status).toBe('delivered')
      expect(savedOrders[0].proofOfDelivery).toBeDefined()
      expect(savedOrders[0].proofOfDelivery.photos).toEqual(['photo1.jpg'])
    })
  })

  describe('addProofPhoto', () => {
    it('sends photo to API and updates cache', async () => {
      mockFetch.mockResolvedValueOnce(undefined)
      const orderWithProof = {
        ...MOCK_ORDERS[0],
        proofOfDelivery: {
          photos: ['existing.jpg'],
          deliveredAt: new Date().toISOString(),
        },
      }
      ;(AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([orderWithProof]))

      const result = await OrderService.addProofPhoto(orderWithProof.orderId, 'new-photo.jpg')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/v1/moves/${orderWithProof.orderId}/proof-photos`,
        {
          method: 'POST',
          body: JSON.stringify({ photoUri: 'new-photo.jpg' }),
        },
      )
    })

    it('returns false when API call fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await OrderService.addProofPhoto(MOCK_ORDERS[0].orderId, 'photo.jpg')

      expect(result).toBe(false)
    })
  })
})
