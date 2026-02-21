// ---------------------------------------------------------------------------
// Moves handler — create, list, assign crew/vehicle, update status
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { canDispatch, canTransition } from '@pegasus/domain'
import type { AppEnv } from '../types'
import {
  createMove,
  findMoveById,
  listMoves,
  updateMoveStatus,
  assignCrewMember,
  assignVehicle,
  listQuotesByMoveId,
} from '../repositories'

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
})

const CreateMoveBody = z.object({
  userId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  scheduledDate: z.string().datetime(),
  origin: AddressSchema,
  destination: AddressSchema,
})

const UpdateStatusBody = z.object({
  status: z.enum(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
})

const AssignCrewBody = z.object({
  crewMemberId: z.string().min(1),
})

const AssignVehicleBody = z.object({
  vehicleId: z.string().min(1),
})

export const movesHandler = new Hono<AppEnv>()

movesHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = CreateMoveBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    try {
      const body = c.req.valid('json')
      const data = await createMove(db, tenantId, {
        userId: body.userId,
        scheduledDate: new Date(body.scheduledDate),
        origin: {
          line1: body.origin.line1,
          city: body.origin.city,
          state: body.origin.state,
          postalCode: body.origin.postalCode,
          country: body.origin.country,
          ...(body.origin.line2 !== undefined ? { line2: body.origin.line2 } : {}),
        },
        destination: {
          line1: body.destination.line1,
          city: body.destination.city,
          state: body.destination.state,
          postalCode: body.destination.postalCode,
          country: body.destination.country,
          ...(body.destination.line2 !== undefined ? { line2: body.destination.line2 } : {}),
        },
        ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      })
      return c.json({ data }, 201)
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

movesHandler.get('/', async (c) => {
  const db = c.get('db')
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')
  try {
    const data = await listMoves(db, { limit, offset })
    return c.json({ data, meta: { count: data.length, limit, offset } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

movesHandler.get('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  try {
    const data = await findMoveById(db, id)
    if (!data) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

movesHandler.put(
  '/:id/status',
  validator('json', (value, c) => {
    const r = UpdateStatusBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    try {
      const { status } = c.req.valid('json')
      const move = await findMoveById(db, id)
      if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
      if (!canTransition(move.status, status)) {
        return c.json(
          {
            error: `Cannot transition move from ${move.status} to ${status}`,
            code: 'INVALID_STATE',
          },
          422,
        )
      }
      // Enforce dispatch pre-condition: crew required before IN_PROGRESS
      if (status === 'IN_PROGRESS' && !canDispatch(move)) {
        return c.json(
          { error: 'At least one crew member must be assigned before dispatch', code: 'PRECONDITION_FAILED' },
          422,
        )
      }
      const data = await updateMoveStatus(db, id, status)
      return c.json({ data })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

movesHandler.post(
  '/:id/crew',
  validator('json', (value, c) => {
    const r = AssignCrewBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    try {
      const { crewMemberId } = c.req.valid('json')
      const data = await assignCrewMember(db, id, crewMemberId)
      if (!data) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
      return c.json({ data })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

movesHandler.post(
  '/:id/vehicles',
  validator('json', (value, c) => {
    const r = AssignVehicleBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    try {
      const { vehicleId } = c.req.valid('json')
      const data = await assignVehicle(db, id, vehicleId)
      if (!data) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
      return c.json({ data })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

movesHandler.get('/:moveId/quotes', async (c) => {
  const db = c.get('db')
  const moveId = c.req.param('moveId')
  try {
    const move = await findMoveById(db, moveId)
    if (!move) return c.json({ error: 'Move not found', code: 'NOT_FOUND' }, 404)
    const data = await listQuotesByMoveId(db, moveId)
    return c.json({ data, meta: { count: data.length } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
