// ---------------------------------------------------------------------------
// Longhaul driver-planning handler — GET list + PATCH confirmed availability
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import { getLonghaulDb } from '../../lib/longhaul-db'
import {
  getDriverPlanning,
  upsertConfirmedAvailability,
} from '../../repositories/longhaul/driver-planning.repository'
import { logger } from '../../lib/logger'

const PatchConfirmedBody = z.object({
  confirmedDate: z.string().nullable(),
  confirmedLocation: z.string().nullable(),
  notes: z.string().nullable().optional(),
})

export const driverPlanningRouter = new Hono<OnPremEnv>()

driverPlanningRouter.get('/driver-planning', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getDriverPlanning(db)
    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('fetchDriverPlanning failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch driver planning',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

driverPlanningRouter.patch(
  '/driver-planning/:driverId',
  validator('json', (value, c) => {
    const r = PatchConfirmedBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const driverId = parseInt(c.req.param('driverId'), 10)
    if (isNaN(driverId)) {
      return c.json(
        {
          error: 'Invalid driver id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    const user = c.get('longhaulUser')
    const body = c.req.valid('json')

    try {
      const db = getLonghaulDb()
      await upsertConfirmedAvailability(
        db,
        driverId,
        {
          confirmedDate: body.confirmedDate,
          confirmedLocation: body.confirmedLocation,
          notes: body.notes ?? null,
        },
        user?.code ?? null,
      )
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('updateConfirmedAvailability failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to update confirmed availability',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)
