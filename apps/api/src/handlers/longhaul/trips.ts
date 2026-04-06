// ---------------------------------------------------------------------------
// Longhaul trips handler — CRUD for trips, statuses, notes, and save logic
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import { getLonghaulDb } from '../../lib/longhaul-db'
import {
  findTripsWithQuery,
  findTripById,
  saveTrip,
  updateTripStatus,
  cancelTrip as cancelTripRepo,
  updateTripSummary,
  getTripStatuses,
  createNote,
  patchNote,
} from '../../repositories/longhaul/trips.repository'
import {
  findActivitiesByTripId,
  insertActivity,
  saveActivity,
  removeActivities,
  updateActivitiesStatus,
  cancelTripActivities,
} from '../../repositories/longhaul/activities.repository'
import {
  findShipmentsByIds,
  patchShipmentShadow,
} from '../../repositories/longhaul/shipments.repository'
import { logger } from '../../lib/logger'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TripNoteBody = z.object({
  note: z.string().min(1),
  type: z.string().optional(),
})

const PatchNoteBody = z.object({
  note: z.string().min(1),
  tripId: z.number().optional(),
})

const PatchTripStatusBody = z.object({
  statusId: z.number(),
  status: z.string().optional(),
})

const TripBody = z
  .object({
    id: z.number().optional(),
    driver: z.record(z.unknown()).nullable().optional(),
    driver_id: z.number().nullable().optional(),
    dispatcher: z.record(z.unknown()).nullable().optional(),
    dispatcher_id: z.union([z.number(), z.string()]).nullable().optional(),
    TripStatus_id: z.number().optional(),
    status: z.record(z.unknown()).nullable().optional(),
    created_by_id: z.number().nullable().optional(),
    updated_by_id: z.number().nullable().optional(),
    origin_state_id: z.number().nullable().optional(),
    destination_state_id: z.number().nullable().optional(),
    finalized_id: z.number().nullable().optional(),
    trip_title: z.string().nullable().optional(),
    total_miles: z.number().nullable().optional(),
    total_effective_deadhead_miles: z.number().nullable().optional(),
    total_estimated_lbs: z.number().nullable().optional(),
    total_actual_lbs: z.number().nullable().optional(),
    total_estimated_linehaul: z.number().nullable().optional(),
    total_estimated_linehaul_usd: z.number().nullable().optional(),
    total_actual_linehaul_usd: z.number().nullable().optional(),
    total_days: z.number().nullable().optional(),
    planned_first_day: z.string().nullable().optional(),
    planned_last_day: z.string().nullable().optional(),
    actual_first_day: z.string().nullable().optional(),
    actual_last_day: z.string().nullable().optional(),
    driver_accepted_date: z.string().nullable().optional(),
    created_date: z.string().nullable().optional(),
    finalized_date: z.string().nullable().optional(),
    shipments: z.array(z.record(z.unknown())).optional(),
    activities: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough()

export const tripsRouter = new Hono<OnPremEnv>()

// ---------------------------------------------------------------------------
// Helper: compute trip summary from activities + shipments
// ---------------------------------------------------------------------------

function daysBetween(date1: unknown, date2: unknown): number {
  if (!date1 || !date2) return 0
  const ONE_DAY = 1000 * 60 * 60 * 24
  const d1 = new Date(date1 as string)
  const d2 = new Date(date2 as string)
  return Math.round(Math.abs(d1.getTime() - d2.getTime()) / ONE_DAY) + 1
}

type Activity = Record<string, unknown>
type Shipment = Record<string, unknown>

function addProperties(activities: Activity[], property: string): number {
  return activities.reduce(
    (acc, a) =>
      acc + (Number((a['shipment'] as Record<string, unknown> | undefined)?.[property]) || 0),
    0,
  )
}

async function computeTripSummary(
  tripId: number,
  activities: Activity[],
  shipmentsMap: Record<number, Shipment>,
): Promise<Record<string, unknown>> {
  const LOAD_CODES = ['LOAD', 'R19O']
  const loads = activities.filter((a) => {
    const code = (a['activityType_code'] || a['ActivityType_code']) as string | undefined
    return code && LOAD_CODES.includes(code)
  })

  const orderNums = new Set(activities.map((a) => a['order_num'] as number).filter(Boolean))

  const uniqueShipments = Array.from(orderNums).map((n) => shipmentsMap[n] ?? {})
  const vipCount = new Set(
    uniqueShipments
      .filter((s) => s['vip'] === 'Y' && s['idc_break'] !== 'Y')
      .map((s) => s['order_num'] as number),
  ).size
  const supervipCount = new Set(
    uniqueShipments.filter((s) => s['idc_break'] === 'Y').map((s) => s['order_num'] as number),
  ).size

  const sortedByStart = [...activities].sort((a, b) => {
    const aDate = new Date(
      (a['actual_date'] || a['estimated_date'] || a['planned_start']) as string,
    )
    const bDate = new Date(
      (b['actual_date'] || b['estimated_date'] || b['planned_start']) as string,
    )
    return aDate.getTime() - bDate.getTime()
  })

  const sortedByEnd = [...activities].sort((a, b) => {
    const aDate = new Date((a['actual_date'] || a['estimated_date'] || a['planned_end']) as string)
    const bDate = new Date((b['actual_date'] || b['estimated_date'] || b['planned_end']) as string)
    return bDate.getTime() - aDate.getTime()
  })

  const originActivity = sortedByStart[0]
  const destinationActivity = sortedByEnd[0]

  const originShipment = originActivity
    ? (shipmentsMap[originActivity['order_num'] as number] ?? {})
    : {}
  const destinationShipment = destinationActivity
    ? (shipmentsMap[destinationActivity['order_num'] as number] ?? {})
    : {}

  const plannedFirstDay =
    originActivity?.['actual_date'] ||
    originActivity?.['estimated_date'] ||
    originActivity?.['planned_start']
  const plannedLastDay =
    destinationActivity?.['actual_date'] ||
    destinationActivity?.['estimated_date'] ||
    destinationActivity?.['planned_end']

  return {
    origin_state_id:
      (originShipment['origin_state'] as Record<string, unknown> | undefined)?.['state_id'] ?? null,
    destination_state_id:
      (destinationShipment['destination_state'] as Record<string, unknown> | undefined)?.[
        'state_id'
      ] ?? null,
    total_estimated_lbs: addProperties(loads, 'total_est_wt'),
    total_actual_lbs: addProperties(loads, 'total_actual_wt'),
    total_estimated_linehaul_usd: addProperties(loads, 'line_haul'),
    total_actual_linehaul_usd: addProperties(loads, 'line_haul'),
    total_days: daysBetween(plannedFirstDay, plannedLastDay),
    planned_first_day: plannedFirstDay ?? null,
    planned_last_day: plannedLastDay ?? null,
    load_activity_count: loads.length,
    vip_count: vipCount,
    supervip_count: supervipCount,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

tripsRouter.get('/trips', async (c) => {
  try {
    const db = getLonghaulDb()

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

    const data = await findTripsWithQuery(db, query)
    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('fetchTrips failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch trips',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

tripsRouter.get('/trips/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (isNaN(id)) {
    return c.json(
      { error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
      400,
    )
  }

  try {
    const db = getLonghaulDb()
    const trip = await findTripById(db, id)
    if (!trip) {
      return c.json(
        { error: 'Trip not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }

    // Fetch shipments for the trip's activities and attach them
    const tripActivities = (trip.activities as Activity[]) ?? []
    const orderNums = [
      ...new Set(tripActivities.map((a) => a['order_num'] as number).filter(Boolean)),
    ]
    const shipments = orderNums.length ? await findShipmentsByIds(db, orderNums) : []

    const tripWithShipments = {
      ...trip,
      shipments: shipments.map((s) => ({
        ...s,
        activities: ((s['activities'] as Activity[]) ?? []).filter(
          (a) => a['TripMaster_id'] === id,
        ),
      })),
    }

    return c.json({ data: tripWithShipments })
  } catch (err) {
    logger.error('fetchTrip failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch trip',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

tripsRouter.post(
  '/trips',
  validator('json', (value, c) => {
    const r = TripBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const body = c.req.valid('json')
    const user = c.get('longhaulUser')

    // Validate: trip must have shipments
    if (!body.shipments?.length) {
      return c.json(
        {
          error: 'Trip must have shipments',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    try {
      const db = getLonghaulDb()
      const result = await saveTripLogic(db, body as Record<string, unknown>, user)
      if (result && typeof result === 'object' && 'error' in result) {
        return c.json(result, 403)
      }
      return c.json({ data: result }, 201)
    } catch (err) {
      logger.error('saveTrip (POST) failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to save trip',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

tripsRouter.put(
  '/trips/:id',
  validator('json', (value, c) => {
    const r = TripBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) {
      return c.json(
        {
          error: 'Invalid trip id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    const body = c.req.valid('json')
    const user = c.get('longhaulUser')

    if (!body.shipments?.length) {
      return c.json(
        {
          error: 'Trip must have shipments',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    try {
      const db = getLonghaulDb()
      const result = await saveTripLogic(db, { ...body, id } as Record<string, unknown>, user)
      if (result && typeof result === 'object' && 'error' in result) {
        return c.json(result, 403)
      }
      return c.json({ data: result })
    } catch (err) {
      logger.error('saveTrip (PUT) failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to save trip',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

tripsRouter.patch(
  '/trips/:id/status',
  validator('json', (value, c) => {
    const r = PatchTripStatusBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tripId = parseInt(c.req.param('id'), 10)
    if (isNaN(tripId)) {
      return c.json(
        {
          error: 'Invalid trip id',
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
      const trip = await findTripById(db, tripId)

      if (!trip) {
        return c.json(
          { error: 'Trip not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
          404,
        )
      }

      const tripActivities = (trip.activities as Activity[]) ?? []
      const driverAssigned = (trip['driver_id'] as number | null) != null

      if (
        !driverAssigned &&
        body.statusId > ((trip['TripStatus_id'] as number) ?? 0) &&
        body.statusId > 1
      ) {
        return c.json(
          {
            error: 'Advancing trip past pending status without an assigned driver is not allowed',
            code: 'VALIDATION_ERROR',
            correlationId: c.get('correlationId'),
          },
          403,
        )
      }

      if (body.statusId >= 5 && tripActivities.some((a) => a['actual_date'] == null)) {
        return c.json(
          {
            error:
              'Advancing trip to finalized is not allowed until all activities have actual dates',
            code: 'VALIDATION_ERROR',
            correlationId: c.get('correlationId'),
          },
          403,
        )
      }

      await updateTripStatus(db, tripId, body.statusId)
      await updateActivitiesStatus(db, tripId, body.statusId, body.status ?? '', user?.code)

      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('changeTripStatus failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to change trip status',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

tripsRouter.post('/trips/:id/cancel', async (c) => {
  const tripId = parseInt(c.req.param('id'), 10)
  if (isNaN(tripId)) {
    return c.json(
      { error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
      400,
    )
  }

  const user = c.get('longhaulUser')

  try {
    const db = getLonghaulDb()
    const trip = await findTripById(db, tripId)

    if (!trip) {
      return c.json(
        { error: 'Trip not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }

    if (((trip['status_id'] as number) ?? 0) >= 4) {
      return c.json(
        {
          error: 'Cancelling trip after in-progress status is not allowed',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    await cancelTripActivities(db, tripId, user?.code)
    await cancelTripRepo(db, tripId, user?.code)

    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('cancelTrip failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to cancel trip',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

tripsRouter.patch(
  '/trips/:id/summary',
  validator('json', (value, c) => {
    const r = z.record(z.unknown()).safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tripId = parseInt(c.req.param('id'), 10)
    if (isNaN(tripId)) {
      return c.json(
        {
          error: 'Invalid trip id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      await updateTripSummary(db, tripId, body)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('updateTripSummaryInfo failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to update trip summary',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

tripsRouter.get('/trip-statuses', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getTripStatuses(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchTripStatuses failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch trip statuses',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

tripsRouter.post(
  '/trips/:id/notes',
  validator('json', (value, c) => {
    const r = TripNoteBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tripId = parseInt(c.req.param('id'), 10)
    if (isNaN(tripId)) {
      return c.json(
        {
          error: 'Invalid trip id',
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
      await createNote(db, {
        tripId,
        note: body.note,
        createdBy: user?.code ?? 0,
        type: body.type ?? 'DISPATCH',
      })
      return c.json({ data: { success: true } }, 201)
    } catch (err) {
      logger.error('createTripNote failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to create note',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

tripsRouter.patch(
  '/notes/:id',
  validator('json', (value, c) => {
    const r = PatchNoteBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const noteId = parseInt(c.req.param('id'), 10)
    if (isNaN(noteId)) {
      return c.json(
        {
          error: 'Invalid note id',
          code: 'VALIDATION_ERROR',
          correlationId: c.get('correlationId'),
        },
        400,
      )
    }

    try {
      const db = getLonghaulDb()
      const body = c.req.valid('json')
      await patchNote(db, body.tripId ?? 0, noteId, body.note)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('patchTripNote failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to patch note',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

// ---------------------------------------------------------------------------
// saveTripLogic — port of TripService.saveTrip with Knex repositories
// ---------------------------------------------------------------------------

async function saveTripLogic(
  db: ReturnType<typeof getLonghaulDb>,
  tripDto: Record<string, unknown>,
  _user: { code: number; [key: string]: unknown } | undefined,
): Promise<Record<string, unknown>> {
  const existingTrip = tripDto['id'] ? await findTripById(db, tripDto['id'] as number) : null

  // Check driver change restriction on in-progress trips
  const dtoStatusId = (tripDto['status'] as Record<string, unknown> | null)?.['status_id'] as
    | number
    | undefined
  if (existingTrip && dtoStatusId != null && dtoStatusId >= 4) {
    const existingDriverId = existingTrip['driver_id'] as number | null
    const dtoDriverId =
      (tripDto['driver'] as Record<string, unknown> | null)?.['id'] ?? tripDto['driver_id'] ?? null
    if (existingDriverId !== dtoDriverId) {
      return { error: 'Cannot change driver on in-progress trip', code: 'VALIDATION_ERROR' }
    }
  }

  const dispatcherCode =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['code'] ??
    tripDto['dispatcher_id'] ??
    null
  const dispatcherFirstName =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['first_name'] ?? ''
  const dispatcherLastName =
    (tripDto['dispatcher'] as Record<string, unknown> | null)?.['last_name'] ?? ''
  const dispatcherName = `${dispatcherFirstName} ${dispatcherLastName}`.trim()

  // If dispatcher changed, cascade to shipments shadow
  if (existingTrip && existingTrip['dispatcher_id'] !== dispatcherCode) {
    const existingActivities = (existingTrip['activities'] as Activity[]) ?? []
    const orderNums = [
      ...new Set(existingActivities.map((a) => a['order_num'] as number).filter(Boolean)),
    ]
    for (const orderNum of orderNums) {
      await patchShipmentShadow(db, {
        order_num: orderNum,
        operations_id: dispatcherCode as string,
        operations_name: dispatcherName,
      })
    }
  }

  const driverId =
    (tripDto['driver'] as Record<string, unknown> | null)?.['id'] ?? tripDto['driver_id'] ?? null
  const driverAgentCode =
    (tripDto['driver'] as Record<string, unknown> | null)?.['agent_code'] ?? null
  const currentStatus =
    (tripDto['status'] as Record<string, unknown> | null)?.['status'] ?? 'Pending'
  const currentStatusTripId = (tripDto['status'] as Record<string, unknown> | null)?.['id'] ?? 1

  // Collect all activities from all shipments in the DTO
  const dtoShipments = (tripDto['shipments'] as Shipment[]) ?? []
  const dtoActivities: Activity[] = []
  for (const shipment of dtoShipments) {
    dtoActivities.push(...((shipment['activities'] as Activity[]) ?? []))
  }

  const existingActivities = existingTrip ? ((existingTrip['activities'] as Activity[]) ?? []) : []

  // Activities to remove (in existing but not in DTO, matched by order_num + activityType.code)
  const activitiesToRemove = existingActivities.filter(
    (dbo) =>
      !dtoActivities.some(
        (dto) =>
          dto['order_num'] === dbo['order_num'] &&
          (dto['activityType'] as Record<string, unknown> | null)?.['code'] ===
            dbo['activityType_code'] &&
          tripDto['id'] === dbo['TripMaster_id'],
      ),
  )

  if (activitiesToRemove.some((a) => a['actual_date'] != null)) {
    return {
      error: `Cannot remove ${activitiesToRemove.length} activity(s) with actual dates from trip`,
      code: 'VALIDATION_ERROR',
    }
  }

  // Activities to update
  const activitiesToUpdate = existingActivities
    .filter((dbo) =>
      dtoActivities.some(
        (dto) =>
          dto['order_num'] === dbo['order_num'] &&
          (dto['activityType'] as Record<string, unknown> | null)?.['code'] ===
            dbo['activityType_code'] &&
          tripDto['id'] === dbo['TripMaster_id'],
      ),
    )
    .map((dbo) => {
      const matching = dtoActivities.find(
        (dto) =>
          dto['order_num'] === dbo['order_num'] &&
          (dto['activityType'] as Record<string, unknown> | null)?.['code'] ===
            dbo['activityType_code'],
      )
      if (!matching) return dbo
      // Merge dto into dbo, stripping relation fields
      const stripped = { ...matching } as Record<string, unknown>
      delete stripped['TripMaster_id']
      delete stripped['shipment']
      delete stripped['activityType']
      delete stripped['pegasus_shadow']
      delete stripped['trip']
      return {
        ...dbo,
        ...stripped,
        assigned_driver_id: driverId,
        assigned_agent_code: driverAgentCode,
        status: currentStatus,
        trip_status_id: currentStatusTripId,
        modified_by: tripDto['updated_by_id'] ?? null,
      }
    })

  // Activities to add (in DTO but not in existing)
  const activitiesToAdd = dtoActivities
    .filter(
      (dto) =>
        !existingActivities.some(
          (dbo) =>
            dto['order_num'] === dbo['order_num'] &&
            (dto['activityType'] as Record<string, unknown> | null)?.['code'] ===
              dbo['activityType_code'] &&
            tripDto['id'] === dbo['TripMaster_id'],
        ),
    )
    .map((dto) => ({
      ...dto,
      assigned_driver_id: driverId,
      assigned_agent_code: driverAgentCode,
      status: currentStatus,
      trip_status_id: currentStatusTripId,
      modified_by: tripDto['updated_by_id'] ?? null,
    }))

  // Build the trip DB row
  const tripRow: Record<string, unknown> = {
    driver_id: driverId,
    dispatcher_id: dispatcherCode,
    TripStatus_id: tripDto['TripStatus_id'] ?? 1,
    created_by_id: tripDto['created_by_id'] ?? null,
    updated_by_id: tripDto['updated_by_id'] ?? null,
    origin_state_id: tripDto['origin_state_id'] ?? null,
    destination_state_id: tripDto['destination_state_id'] ?? null,
    finalized_id: tripDto['finalized_id'] ?? null,
    trip_title: tripDto['trip_title'] ?? null,
    total_miles: tripDto['total_miles'] ?? null,
    total_effective_deadhead_miles: tripDto['total_effective_deadhead_miles'] ?? null,
    total_estimated_lbs: tripDto['total_estimated_lbs'] ?? null,
    total_actual_lbs: tripDto['total_actual_lbs'] ?? null,
    total_estimated_linehaul_usd:
      tripDto['total_estimated_linehaul'] ?? tripDto['total_estimated_linehaul_usd'] ?? null,
    total_actual_linehaul_usd: tripDto['total_actual_linehaul_usd'] ?? null,
    total_days: tripDto['total_days'] ?? null,
    planned_first_day: tripDto['planned_first_day'] ?? null,
    planned_last_day: tripDto['planned_last_day'] ?? null,
    actual_first_day: tripDto['actual_first_day'] ?? null,
    actual_last_day: tripDto['actual_last_day'] ?? null,
    driver_accepted_date: tripDto['driver_accepted_date'] ?? null,
    finalized_date: tripDto['finalized_date'] ?? null,
    ...(tripDto['id'] ? {} : { created_date: tripDto['created_date'] ?? new Date() }),
  }

  if (tripDto['id']) {
    tripRow['id'] = tripDto['id']
  }

  const savedTrip = await saveTrip(db, tripRow)
  const newTripId = (savedTrip?.['id'] ?? tripDto['id']) as number

  // Remove, add, and update activities
  const removeIds = activitiesToRemove.map((a) => a['id'] as number).filter(Boolean)
  if (removeIds.length) {
    await removeActivities(db, removeIds, tripDto['updated_by_id'] as number | undefined)
  }

  for (const activity of activitiesToAdd) {
    const act = { ...activity } as Record<string, unknown>
    const activityTypeCode =
      (act['activityType'] as Record<string, unknown> | null)?.['code'] ?? act['ActivityType_code']
    delete act['activityType']
    delete act['shipment']
    delete act['pegasus_shadow']
    delete act['trip']
    await insertActivity(db, {
      ...act,
      TripMaster_id: newTripId,
      ActivityType_code: activityTypeCode,
    })
  }

  for (const activity of activitiesToUpdate) {
    const activityId = (activity['id'] ?? activity['activityId']) as number | undefined
    if (activityId) {
      const fields = { ...activity } as Record<string, unknown>
      delete fields['activityType']
      delete fields['shipment']
      delete fields['pegasus_shadow']
      delete fields['trip']
      delete fields['id']
      delete fields['activityId']
      await saveActivity(db, activityId, fields, tripDto['updated_by_id'] as number | undefined)
    }
  }

  // Recompute trip summary from activities
  const updatedActivities = await findActivitiesByTripId(db, newTripId)
  const orderNums = [
    ...new Set(updatedActivities.map((a) => a['order_num'] as number).filter(Boolean)),
  ]
  const shipmentsForSummary = orderNums.length ? await findShipmentsByIds(db, orderNums) : []
  const shipmentsMap: Record<number, Shipment> = {}
  for (const s of shipmentsForSummary) {
    shipmentsMap[s['order_num'] as number] = s
  }

  if (updatedActivities.length > 0) {
    const summary = await computeTripSummary(newTripId, updatedActivities, shipmentsMap)
    await updateTripSummary(db, newTripId, summary)
  }

  return (await findTripById(db, newTripId)) ?? {}
}
