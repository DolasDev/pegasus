// ---------------------------------------------------------------------------
// Inventory bounded context
// Tracks everything being moved, item by item, room by room.
// ---------------------------------------------------------------------------

import type { Brand, Money } from '../shared/types'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies an InventoryRoom. */
export type InventoryRoomId = Brand<string, 'InventoryRoomId'>

/** Uniquely identifies an InventoryItem. */
export type InventoryItemId = Brand<string, 'InventoryItemId'>

export const toInventoryRoomId = (raw: string): InventoryRoomId => raw as InventoryRoomId
export const toInventoryItemId = (raw: string): InventoryItemId => raw as InventoryItemId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/**
 * The physical condition of an item, recorded at pack and at delivery.
 * DAMAGED and MISSING trigger the claims workflow.
 */
export type ItemCondition = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'DAMAGED' | 'MISSING'

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * A single inventory item within a room.
 *
 * Condition is recorded twice: at packing (`conditionAtPack`) and at delivery
 * (`conditionAtDelivery`). A mismatch between the two initiates a damage claim.
 *
 * @invariant `conditionAtDelivery` may only be set once (`conditionAtPack` must already exist).
 */
export interface InventoryItem {
  readonly id: InventoryItemId
  readonly roomId: InventoryRoomId
  readonly name: string
  readonly description?: string
  readonly quantity: number
  readonly declaredValue?: Money
  readonly conditionAtPack?: ItemCondition
  readonly conditionAtDelivery?: ItemCondition
}

/**
 * A logical grouping of inventory items by room (e.g. "Master Bedroom", "Kitchen").
 *
 * @invariant `name` must be non-empty.
 */
export interface InventoryRoom {
  readonly id: InventoryRoomId
  readonly name: string
  readonly items: readonly InventoryItem[]
}

/**
 * Calculates the total declared value of all items in a room.
 * Items without a `declaredValue` contribute zero.
 */
export function roomTotalValue(room: InventoryRoom, currency = 'USD'): Money {
  const total = room.items.reduce((sum, item) => {
    if (item.declaredValue && item.declaredValue.currency === currency) {
      return sum + item.declaredValue.amount * item.quantity
    }
    return sum
  }, 0)
  return { amount: total, currency }
}
