// ---------------------------------------------------------------------------
// Longhaul shipments handler
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import {
  findShipmentsWithQuery,
  saveCoverage,
  patchWeight,
  patchShipmentShadow,
} from '../../repositories/longhaul/shipments.repository'
import {
  enrichShipmentWithTripInfo,
  buildExtraShipmentActivities,
  loadActivityTypesMap,
  type ShipmentRow,
} from '../../lib/longhaul-shipment-enrich'
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

// Maximum number of shipments returned after enrichment + post-fetch filters.
// Mirrors the legacy guard in shipment.service.ts:57-58.
const SHIPMENT_RESULT_LIMIT = 1000

shipmentsRouter.get('/shipments', async (c) => {
  const db = c.get('longhaulDb')

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

  // Fetch + enrich. The activityTypes map is fetched in parallel so the
  // extra-activity templates can attach the full ActivityType row (legacy
  // behaviour — see ActivityService constructor in activity.service.ts).
  const [rawShipments, activityTypesMap] = await Promise.all([
    findShipmentsWithQuery(db, query),
    loadActivityTypesMap(db).catch((err) => {
      // Non-fatal: extras still attach without the activityType row, matching
      // legacy behaviour when the catalogue is empty.
      logger.warn('loadActivityTypesMap failed; extras will lack activityType', {
        error: String(err),
      })
      return {}
    }),
  ])

  // Post-fetch TripStatus_id filter — legacy shipment.service.ts:47-54.
  // The shipment view doesn't carry TripStatus_id directly; it comes from the
  // most-recent activity via getTripInfo, so the filter must run after merge.
  const filters = (query['filters'] as Record<string, unknown> | undefined) ?? {}
  const tripStatusIds = filters['TripStatus_id'] as Array<{ value: string | number }> | undefined
  const wantedTripStatusIds =
    tripStatusIds && tripStatusIds.length > 0
      ? new Set(tripStatusIds.map((v) => String(v.value)))
      : null

  const enriched: ShipmentRow[] = []
  for (const raw of rawShipments as ShipmentRow[]) {
    enrichShipmentWithTripInfo(raw)
    if (wantedTripStatusIds && !wantedTripStatusIds.has(String(raw['TripStatus_id'] ?? ''))) {
      continue
    }
    raw.extraActivities = buildExtraShipmentActivities(raw, activityTypesMap)
    enriched.push(raw)
  }

  if (enriched.length > SHIPMENT_RESULT_LIMIT) {
    return c.json(
      {
        error: 'Too many results — please narrow your filters.',
        code: 'RESULT_LIMIT_EXCEEDED',
        correlationId: c.get('correlationId'),
      },
      400,
    )
  }

  // TODO(longhaul-port-audit): Port `buildShipmentActivities` (required
  // activity templates) from legacy activity.service.ts:142-237 — it appends
  // default PACK/LOAD/RDEL/R19O activity rows to shipments missing them so the
  // UI can render the planning grid even when the trip hasn't been built yet.
  // Tracked separately from this unit's scope (extras + filter + cap only).
  return c.json({ data: enriched, meta: { count: enriched.length } })
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
      const db = c.get('longhaulDb')
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
      const db = c.get('longhaulDb')
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
      const db = c.get('longhaulDb')
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
