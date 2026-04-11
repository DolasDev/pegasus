import AsyncStorage from '@react-native-async-storage/async-storage'
import { type TruckingOrder, type OrderStatus } from '../types'
import { getApiClient } from '../api/client'
import { logger } from '../utils/logger'

const ORDERS_STORAGE_KEY = '@moving_app_orders'

export class OrderService {
  static async getOrders(): Promise<TruckingOrder[]> {
    try {
      const client = getApiClient()
      const result = await client.fetchPaginated<TruckingOrder>('/api/v1/moves')
      const orders = result.data
      // Cache successful API response
      await AsyncStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders))
      logger.logOrderLoad(orders.length)
      return orders
    } catch (error) {
      logger.warn('API fetch failed, falling back to cache', error)
      // Offline fallback: return cached data
      try {
        const stored = await AsyncStorage.getItem(ORDERS_STORAGE_KEY)
        if (stored) {
          const orders = JSON.parse(stored) as TruckingOrder[]
          logger.logOrderLoad(orders.length)
          return orders
        }
      } catch (cacheError) {
        logger.error('Cache read failed', cacheError)
      }
      return []
    }
  }

  static async getOrderById(orderId: string): Promise<TruckingOrder | null> {
    try {
      const client = getApiClient()
      const order = await client.fetch<TruckingOrder>(`/api/v1/moves/${orderId}`)
      return order
    } catch {
      // Fallback to cached list
      const orders = await this.getOrdersFromCache()
      return orders.find((o) => o.orderId === orderId) ?? null
    }
  }

  static async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    proofPhotos?: string[],
  ): Promise<boolean> {
    try {
      const client = getApiClient()
      await client.fetch(`/api/v1/moves/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, proofPhotos }),
      })
      logger.logOrderStatusChange(orderId, '', status)

      // Update cache optimistically
      await this.updateCachedOrderStatus(orderId, status, proofPhotos)
      return true
    } catch (error) {
      logger.error('Error updating order status', error)
      return false
    }
  }

  static async addProofPhoto(orderId: string, photoUri: string): Promise<boolean> {
    try {
      const client = getApiClient()
      await client.fetch(`/api/v1/moves/${orderId}/proof-photos`, {
        method: 'POST',
        body: JSON.stringify({ photoUri }),
      })

      // Update cache
      const orders = await this.getOrdersFromCache()
      const orderIndex = orders.findIndex((o) => o.orderId === orderId)
      if (orderIndex !== -1) {
        const order = orders[orderIndex]
        if (!order.proofOfDelivery) {
          order.proofOfDelivery = {
            photos: [photoUri],
            deliveredAt: new Date().toISOString(),
          }
        } else {
          order.proofOfDelivery.photos.push(photoUri)
        }
        order.updatedAt = new Date().toISOString()
        orders[orderIndex] = order
        await AsyncStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders))
        logger.logCameraCapture(orderId, order.proofOfDelivery.photos.length)
      }
      return true
    } catch (error) {
      logger.error('Error adding proof photo', error)
      return false
    }
  }

  private static async getOrdersFromCache(): Promise<TruckingOrder[]> {
    try {
      const stored = await AsyncStorage.getItem(ORDERS_STORAGE_KEY)
      if (stored) return JSON.parse(stored) as TruckingOrder[]
    } catch {
      // Cache corrupted
    }
    return []
  }

  private static async updateCachedOrderStatus(
    orderId: string,
    status: OrderStatus,
    proofPhotos?: string[],
  ): Promise<void> {
    try {
      const orders = await this.getOrdersFromCache()
      const orderIndex = orders.findIndex((o) => o.orderId === orderId)
      if (orderIndex === -1) return

      const oldStatus = orders[orderIndex].status
      const updatedOrder = {
        ...orders[orderIndex],
        status,
        updatedAt: new Date().toISOString(),
      }

      if (status === 'in_transit' && !updatedOrder.pickup.actualDate) {
        updatedOrder.pickup.actualDate = new Date().toISOString()
      }

      if (status === 'delivered') {
        updatedOrder.dropoff.actualDate = new Date().toISOString()
        updatedOrder.proofOfDelivery = {
          photos: proofPhotos ?? [],
          deliveredAt: new Date().toISOString(),
          notes: 'Delivered successfully',
        }
      }

      orders[orderIndex] = updatedOrder
      await AsyncStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders))
      logger.logOrderStatusChange(orderId, oldStatus, status)
    } catch {
      // Cache update is best-effort
    }
  }
}
