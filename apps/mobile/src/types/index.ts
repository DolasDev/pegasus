/**
 * Re-export domain types for the mobile app.
 *
 * The mobile app uses "TruckingOrder" terminology for driver-facing screens.
 * These are transitional aliases mapping to the domain model's Move type.
 *
 * TODO: Once the mobile app fully adopts domain types, remove these aliases
 * and import from @pegasus/domain directly.
 */
import type { Move, MoveStatus as DomainMoveStatus } from '@pegasus/domain'

/**
 * Mobile-facing order type. Currently defined locally because the mobile
 * order shape (flat pickup/dropoff, inventory array, customer inline)
 * differs from the domain Move model (stops array, separate customer entity).
 *
 * TODO: Converge this type with Serialized<Move> once the API returns a
 * mobile-friendly response shape, or build a mapper in the API client.
 */
export interface TruckingOrder {
  orderId: string
  orderNumber: string

  pickup: {
    address: string
    city: string
    state: string
    zipCode: string
    coordinates?: {
      latitude: number
      longitude: number
    }
    scheduledDate: string
    actualDate?: string
  }

  dropoff: {
    address: string
    city: string
    state: string
    zipCode: string
    coordinates?: {
      latitude: number
      longitude: number
    }
    scheduledDate: string
    actualDate?: string
  }

  inventory: InventoryItem[]

  customer: {
    name: string
    phone: string
    email: string
    notes?: string
  }

  status: OrderStatus

  proofOfDelivery?: {
    photos: string[]
    signature?: string
    deliveredAt: string
    notes?: string
  }

  assignedDriverId: string
  createdAt: string
  updatedAt: string
}

export interface InventoryItem {
  id: string
  description: string
  quantity: number
  weight?: number
  fragile: boolean
  notes?: string
}

export interface Driver {
  id: string
  name: string
  email: string
  phone: string
  licenseNumber: string
  truckId?: string
}

export type OrderStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled'

// Re-export domain types that consumers may need directly
export type { Move, DomainMoveStatus }
