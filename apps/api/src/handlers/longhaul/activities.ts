// ---------------------------------------------------------------------------
// Longhaul activities handler
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import {
  findActivityById,
  insertActivity,
  saveActivity,
} from '../../repositories/longhaul/activities.repository'
import { updateTripSummaryInfo } from '../../repositories/longhaul/trips.repository'
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
  TripMaster_id: z.number().nullable().optional(),
})

const CreateActivityBody = PatchActivityBody.extend({
  order_num: z.number(),
  ActivityType_code: z.string(),
})

export const activitiesRouter = new Hono<OnPremEnv>()

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
      const db = c.get('longhaulDb')
      const body = c.req.valid('json')

      // Capture the pre-update TripMaster_id so we can detect a cascade
      // (activity moved between trips) and recompute both summaries.
      const existing = await findActivityById(db, activityId)
      const previousTripId = (existing?.['TripMaster_id'] as number | null | undefined) ?? null

      await saveActivity(db, activityId, body as Record<string, unknown>, user?.code)

      const nextTripId =
        body.TripMaster_id !== undefined ? (body.TripMaster_id ?? null) : previousTripId

      // Recompute summary for both the new and previous trip (set dedupes
      // when they match — the common in-place-update case).
      const recompute = new Set<number>()
      if (nextTripId != null) recompute.add(nextTripId)
      if (previousTripId != null) recompute.add(previousTripId)
      for (const tripId of recompute) {
        await updateTripSummaryInfo(db, tripId)
      }

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

activitiesRouter.post(
  '/activities',
  validator('json', (value, c) => {
    const r = CreateActivityBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const user = c.get('longhaulUser')

    try {
      const db = c.get('longhaulDb')
      const body = c.req.valid('json')

      const newId = await insertActivity(db, {
        ...(body as Record<string, unknown>),
        modified_by: user?.code ?? null,
      })

      if (body.TripMaster_id != null) {
        await updateTripSummaryInfo(db, body.TripMaster_id)
      }

      return c.json({ data: { id: newId } }, 201)
    } catch (err) {
      logger.error('insertActivity failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to create activity',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)
