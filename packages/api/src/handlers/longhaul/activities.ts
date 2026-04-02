// ---------------------------------------------------------------------------
// Longhaul activities handler
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { getLonghaulDb } from '../../lib/longhaul-db'
import { saveActivity } from '../../repositories/longhaul/activities.repository'
import { logger } from '../../lib/logger'

const PatchActivityBody = z.object({
  estimated_date: z.string().nullable().optional(),
  actual_date: z.string().nullable().optional(),
  status: z.string().optional(),
  planned_start: z.string().nullable().optional(),
  planned_end: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  is_confirmed: z.boolean().optional(),
  is_committed: z.boolean().optional(),
  trip_status_id: z.number().nullable().optional(),
  assigned_driver_id: z.number().nullable().optional(),
  assigned_agent_code: z.string().nullable().optional(),
  location_id: z.number().nullable().optional(),
})

export const activitiesRouter = new Hono<AppEnv>()

activitiesRouter.post(
  '/activities/:id',
  validator('json', (value, c) => {
    const r = PatchActivityBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const activityId = parseInt(c.req.param('id'), 10)
    if (isNaN(activityId)) {
      return c.json(
        {
          error: 'Invalid activity id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    const user = c.get('longhaulUser')

    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      await saveActivity(db, activityId, body as Record<string, unknown>, user?.code)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('saveActivity failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to save activity',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)
