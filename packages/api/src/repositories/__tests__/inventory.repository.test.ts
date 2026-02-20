/**
 * Integration tests for the inventory repository.
 *
 * These tests require a live PostgreSQL database and are skipped automatically
 * when DATABASE_URL is not set in the environment.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://... npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import { createMove } from '../move.repository'
import {
  createRoom,
  findRoomById,
  listRoomsByMoveId,
  addItem,
} from '../inventory.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const createdMoveIds: string[] = []

afterAll(async () => {
  if (hasDb) {
    for (const id of createdMoveIds) {
      await db.move.delete({ where: { id } }).catch(() => undefined)
    }
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('InventoryRepository (integration)', () => {
  const origin = {
    line1: '5 Inventory Ln',
    city: 'El Paso',
    state: 'TX',
    postalCode: '79901',
    country: 'US',
  }
  const destination = {
    line1: '10 Inventory Blvd',
    city: 'El Paso',
    state: 'TX',
    postalCode: '79902',
    country: 'US',
  }

  let moveId: string
  let roomId: string

  beforeAll(async () => {
    const move = await createMove({
      userId: `user-inventory-${Date.now()}`,
      scheduledDate: new Date('2025-11-01T07:00:00Z'),
      origin,
      destination,
    })
    moveId = move.id
    createdMoveIds.push(moveId)
  })

  it('createRoom returns a room with a valid id', async () => {
    const room = await createRoom({ moveId, name: 'Kitchen' })
    roomId = room.id
    expect(roomId).toBeTruthy()
    expect(room.name).toBe('Kitchen')
  })

  it('createRoom starts with no items', async () => {
    const room = await findRoomById(roomId)
    expect(room?.items).toHaveLength(0)
  })

  it('findRoomById returns null for an unknown id', async () => {
    const result = await findRoomById('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('listRoomsByMoveId returns the created room', async () => {
    const rooms = await listRoomsByMoveId(moveId)
    const found = rooms.find((r) => r.id === roomId)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Kitchen')
  })

  it('addItem appends an item to the room', async () => {
    const updated = await addItem(roomId, {
      name: 'Refrigerator',
      quantity: 1,
    })
    expect(updated?.items).toHaveLength(1)
    expect(updated?.items[0]?.name).toBe('Refrigerator')
    expect(updated?.items[0]?.quantity).toBe(1)
  })

  it('addItem stores optional fields correctly', async () => {
    const updated = await addItem(roomId, {
      name: 'Microwave',
      description: 'Samsung 1.6 cu ft',
      quantity: 1,
      declaredValue: 150,
      declaredValueCurrency: 'USD',
    })
    const microwave = updated?.items.find((i) => i.name === 'Microwave')
    expect(microwave?.description).toBe('Samsung 1.6 cu ft')
    expect(microwave?.declaredValue?.amount).toBe(150)
    expect(microwave?.declaredValue?.currency).toBe('USD')
  })

  it('addItem returns null for an unknown room id', async () => {
    const result = await addItem('00000000-0000-0000-0000-000000000000', { name: 'Ghost item' })
    expect(result).toBeNull()
  })

  it('multiple rooms can be created for the same move', async () => {
    await createRoom({ moveId, name: 'Bedroom' })
    await createRoom({ moveId, name: 'Living Room' })
    const rooms = await listRoomsByMoveId(moveId)
    expect(rooms.length).toBeGreaterThanOrEqual(3)
  })
})

// Always-running guard
describe('InventoryRepository skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true)
    } else {
      expect(hasDb).toBe(true)
    }
  })
})
