// ---------------------------------------------------------------------------
// Longhaul shipments handler
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import { getLonghaulDb } from '../../lib/longhaul-db'
import {
  findShipmentsWithQuery,
  saveCoverage,
  patchWeight,
  patchShipmentShadow,
} from '../../repositories/longhaul/shipments.repository'
import { logger } from '../../lib/logger'

const CoverageBody = z.object({
  order_num: z.number(),
  activity_code: z.string().min(1),
  coverage_agent_id: z.string().min(1),
  note: z.string().nullable().optional(),
  is_covered: z.boolean().nullable().optional(),
  created_by_id: z.number().optional(),
  updated_by_id: z.number().nullable().optional(),
})

const WeightBody = z.object({
  order_num: z.number().optional(),
  weight: z.number().nullable().optional(),
})

const ShadowBody = z.object({
  order_num: z.number(),
  operations_id: z.string().nullable().optional(),
  operations_name: z.string().nullable().optional(),
  lng_dis_comments: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
})

export const shipmentsRouter = new Hono<OnPremEnv>()

shipmentsRouter.get('/shipments', async (c) => {
  try {
    const db = getLonghaulDb()

    // Accept filters as a JSON-encoded query param or body
    let query: Record<string, unknown> = {}
    const rawFilters = c.req.query('filters')
    if (rawFilters) {
      try {
        query = JSON.parse(rawFilters)
      } catch {
        return c.json(
          {
            error: 'Invalid filters JSON',
            code: 'VALIDATION_ERROR',
            correlationId: c.get('correlationId'),
          },
          400,
        )
      }
    }

    const searchTerm = c.req.query('searchTerm')
    if (searchTerm) query['searchTerm'] = searchTerm

    const data = await findShipmentsWithQuery(db, query)
    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('fetchShipments failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch shipments',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

shipmentsRouter.post(
  '/shipments/:id/coverage',
  validator('json', (value, c) => {
    const r = CoverageBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      const data = await saveCoverage(db, body)
      return c.json({ data }, 201)
    } catch (err) {
      logger.error('saveShipmentCoverage failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to save coverage',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

shipmentsRouter.patch(
  '/shipments/:id/weight',
  validator('json', (value, c) => {
    const r = WeightBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const shipmentId = parseInt(c.req.param('id'), 10)
    if (isNaN(shipmentId)) {
      return c.json(
        {
          error: 'Invalid shipment id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      await patchWeight(db, shipmentId, body as Record<string, unknown>)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('patchWeight failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to patch weight',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

shipmentsRouter.patch(
  '/shipments/:id/shadow',
  validator('json', (value, c) => {
    const r = ShadowBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      await patchShipmentShadow(db, body)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('patchShipmentShadow failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to patch shipment shadow',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)
