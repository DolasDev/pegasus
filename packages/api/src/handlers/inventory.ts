// ---------------------------------------------------------------------------
// Inventory handler — rooms and items nested under /moves/:moveId
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { roomTotalValue } from '@pegasus/domain'
import type { AppEnv } from '../types'
import {
  findMoveById,
  createRoom,
  findRoomById,
  listRoomsByMoveId,
  addItem,
} from '../repositories'

const CreateRoomBody = z.object({
  name: z.string().min(1),
})

const AddItemBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  quantity: z.number().int().positive().optional(),
  declaredValue: z.number().positive().optional(),
  declaredValueCurrency: z.string().min(1).optional(),
})

export const inventoryHandler = new Hono<AppEnv>()

inventoryHandler.post(
  '/:moveId/rooms',
  validator('json', (value, c) => {
    const r = CreateRoomBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const moveId = c.req.param('moveId')
    try {
      const move = await findMoveById(db, moveId)
      if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
      const { name } = c.req.valid('json')
      const data = await createRoom(db, tenantId, { moveId, name })
      return c.json({ data }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

inventoryHandler.get('/:moveId/inventory', async (c) => {
  const db = c.get('db')
  const moveId = c.req.param('moveId')
  try {
    const move = await findMoveById(db, moveId)
    if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
    const rooms = await listRoomsByMoveId(db, moveId)
    const data = rooms.map((room) => ({ ...room, totalValue: roomTotalValue(room) }))
    return c.json({ data, meta: { count: rooms.length } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

inventoryHandler.post(
  '/:moveId/rooms/:roomId/items',
  validator('json', (value, c) => {
    const r = AddItemBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const moveId = c.req.param('moveId')
    const roomId = c.req.param('roomId')
    try {
      const move = await findMoveById(db, moveId)
      if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
      const body = c.req.valid('json')
      const room = await findRoomById(db, roomId)
      if (!room) return c.json({ error: 'Room not found', code: 'NOT_FOUND' }, 404)
      const data = await addItem(db, roomId, {
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.declaredValue !== undefined ? { declaredValue: body.declaredValue } : {}),
        ...(body.declaredValueCurrency !== undefined
          ? { declaredValueCurrency: body.declaredValueCurrency }
          : {}),
      })
      return c.json({ data }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)
