import type { PrismaClient, Prisma } from '@prisma/client'
import type { InventoryRoom, InventoryItem } from '@pegasus/domain'
import { toInventoryRoomId, toInventoryItemId } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Include shape
// ---------------------------------------------------------------------------

const roomInclude = { items: true } satisfies Prisma.InventoryRoomInclude

type RawRoom = Prisma.InventoryRoomGetPayload<{ include: typeof roomInclude }>
type RawItem = RawRoom['items'][number]

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapItem(row: RawItem): InventoryItem {
  return {
    id: toInventoryItemId(row.id),
    roomId: toInventoryRoomId(row.roomId),
    name: row.name,
    quantity: row.quantity,
    ...(row.description != null ? { description: row.description } : {}),
    ...(row.declaredValue != null
      ? {
          declaredValue: {
            amount: Number(row.declaredValue),
            currency: row.declaredValueCurrency ?? 'USD',
          },
        }
      : {}),
    ...(row.conditionAtPack != null ? { conditionAtPack: row.conditionAtPack } : {}),
    ...(row.conditionAtDelivery != null ? { conditionAtDelivery: row.conditionAtDelivery } : {}),
  }
}

function mapRoom(row: RawRoom): InventoryRoom {
  return {
    id: toInventoryRoomId(row.id),
    name: row.name,
    items: row.items.map(mapItem),
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export type CreateRoomInput = {
  moveId: string
  name: string
}

export type AddItemInput = {
  name: string
  description?: string
  quantity?: number
  declaredValue?: number
  declaredValueCurrency?: string
}

/** Creates an inventory room for a move. */
export async function createRoom(
  db: PrismaClient,
  tenantId: string,
  input: CreateRoomInput,
): Promise<InventoryRoom> {
  const row = await db.inventoryRoom.create({
    data: { tenantId, moveId: input.moveId, name: input.name },
    include: roomInclude,
  })
  return mapRoom(row)
}

/** Returns a room by ID with all its items. Returns null if not found. */
export async function findRoomById(db: PrismaClient, id: string): Promise<InventoryRoom | null> {
  const row = await db.inventoryRoom.findUnique({ where: { id }, include: roomInclude })
  return row ? mapRoom(row) : null
}

/** Lists all rooms for a move, ordered by creation time. */
export async function listRoomsByMoveId(db: PrismaClient, moveId: string): Promise<InventoryRoom[]> {
  const rows = await db.inventoryRoom.findMany({
    where: { moveId },
    include: roomInclude,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(mapRoom)
}

/** Adds an inventory item to a room. Returns the updated room, or null if the room is not found. */
export async function addItem(
  db: PrismaClient,
  roomId: string,
  input: AddItemInput,
): Promise<InventoryRoom | null> {
  const room = await db.inventoryRoom.findUnique({ where: { id: roomId }, select: { id: true } })
  if (!room) return null
  await db.inventoryItem.create({
    data: {
      roomId,
      name: input.name,
      quantity: input.quantity ?? 1,
      ...(input.description != null ? { description: input.description } : {}),
      ...(input.declaredValue != null ? { declaredValue: input.declaredValue } : {}),
      ...(input.declaredValueCurrency != null
        ? { declaredValueCurrency: input.declaredValueCurrency }
        : {}),
    },
  })
  return findRoomById(db, roomId)
}
