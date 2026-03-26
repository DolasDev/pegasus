import AsyncStorage from '@react-native-async-storage/async-storage'
import { type TruckingOrder, type OrderStatus } from '../types'
import { MOCK_ORDERS } from './mockData'
import { logger } from '../utils/logger'

const ORDERS_STORAGE_KEY = '@moving_app_orders'

export class OrderService {
  static async getOrders(): Promise<TruckingOrder[]> {
    try {
      const stored = await AsyncStorage.getItem(ORDERS_STORAGE_KEY)
      if (stored) {
        const orders = JSON.parse(stored)
        logger.logOrderLoad(orders.length)
        return orders
      }
      // Initialize with mock data on first load
      await AsyncStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(MOCK_ORDERS))
      logger.logOrderLoad(MOCK_ORDERS.length)
      return MOCK_ORDERS
    } catch (error) {
      logger.error('Error loading orders', error)
      return MOCK_ORDERS
    }
  }

  static async getOrderById(orderId: string): Promise<TruckingOrder | null> {
    const orders = await this.getOrders()
    return orders.find((o) => o.orderId === orderId) || null
  }

  static async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    proofPhotos?: string[],
  ): Promise<boolean> {
    try {
      const orders = await this.getOrders()
      const orderIndex = orders.findIndex((o) => o.orderId === orderId)

      if (orderIndex === -1) return false

      const oldStatus = orders[orderIndex].status
      const updatedOrder = {
        ...orders[orderIndex],
        status,
        updatedAt: new Date().toISOString(),
      }

      // Update actual dates based on status
      if (status === 'in_transit' && !updatedOrder.pickup.actualDate) {
        updatedOrder.pickup.actualDate = new Date().toISOString()
      }

      if (status === 'delivered') {
        updatedOrder.dropoff.actualDate = new Date().toISOString()
        updatedOrder.proofOfDelivery = {
          photos: proofPhotos || [],
          deliveredAt: new Date().toISOString(),
          notes: 'Delivered successfully',
        }
      }

      orders[orderIndex] = updatedOrder
      await AsyncStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders))
      logger.logOrderStatusChange(orderId, oldStatus, status)
      return true
    } catch (error) {
      logger.error('Error updating order', error)
      return false
    }
  }

  static async addProofPhoto(orderId: string, photoUri: string): Promise<boolean> {
    try {
      const orders = await this.getOrders()
      const orderIndex = orders.findIndex((o) => o.orderId === orderId)

      if (orderIndex === -1) return false

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
      return true
    } catch (error) {
      logger.error('Error adding proof photo', error)
      return false
    }
  }
}
