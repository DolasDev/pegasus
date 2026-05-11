// ---------------------------------------------------------------------------
// Longhaul trips repository — Knex queries against TripMaster and TripNotes
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'
import { findShipmentsByIds } from './shipments.repository'

const TRIPS_TABLE = 'TripMaster'
const NOTES_TABLE = 'TripNotes'
const ACTIVITIES_TABLE = 'LongDistanceDispatchActivity'

export interface TripQuery {
  filters?: {
    id?: string
    driver_id?: { label: string; value: string }
    origin?: Array<{ value: { state_id: number } }>
    destination?: Array<{ value: { state_id: number } }>
    origin_zone?: Array<{ value: string }>
    destination_zone?: Array<{ value: string }>
    weight?: [number | null, number | null]
    planned_date?: [string | null, string | null]
    planned_start?: [string | null, string | null]
    planned_end?: [string | null, string | null]
    TripStatus_id?: Array<{ value: string }>
    internal_status?: Array<{ value: string }>
    planner_id?: Array<{ value: string }>
    dispatcher_id?: Array<{ value: string }>
  }
  sortBy?: { value: string; order: string }
}

/**
 * Fetch trips matching the provided query filters. Joins status, driver, notes,
 * origin/destination state info, and planner/dispatcher users.
 */
export async function findTripsWithQuery(db: Knex, query: TripQuery) {
  let qb = db(TRIPS_TABLE)
    .select(
      `${TRIPS_TABLE}.*`,
      'ts.status as status_status',
      'ts.status_id as status_id',
      'drv.driver_name',
      'drv.agent_code',
      'os.geo_code as origin_geo_code',
      'os.geo_name as origin_geo_name',
      'os.zone as origin_zone_code',
      'ds.geo_code as destination_geo_code',
      'ds.geo_name as destination_geo_name',
      'ds.zone as destination_zone_code',
      'pu.first_name as planner_first_name',
      'pu.last_name as planner_last_name',
      'du.first_name as dispatcher_first_name',
      'du.last_name as dispatcher_last_name',
    )
    .leftJoin('MasterTripStatus as ts', `${TRIPS_TABLE}.TripStatus_id`, 'ts.status_id')
    .leftJoin('v_longhaul_drivers as drv', `${TRIPS_TABLE}.driver_id`, 'drv.driver_id')
    .leftJoin('v_longhaul_states as os', `${TRIPS_TABLE}.origin_state_id`, 'os.id')
    .leftJoin('v_longhaul_states as ds', `${TRIPS_TABLE}.destination_state_id`, 'ds.id')
    .leftJoin('v_longhaul_salesman as pu', `${TRIPS_TABLE}.created_by_id`, 'pu.code')
    .leftJoin('v_longhaul_salesman as du', `${TRIPS_TABLE}.dispatcher_id`, 'du.code')

  const filters = query.filters
  if (filters) {
    if (filters.id) {
      qb = qb.where(`${TRIPS_TABLE}.id`, filters.id)
    }

    if (filters.driver_id?.value) {
      qb = qb.where(`${TRIPS_TABLE}.driver_id`, filters.driver_id.value)
    }

    if (filters.origin?.length) {
      const stateIds = filters.origin.map((o) => o.value?.state_id).filter(Boolean)
      if (stateIds.length) qb = qb.whereIn('origin_state_id', stateIds)
    }

    if (filters.destination?.length) {
      const stateIds = filters.destination.map((d) => d.value?.state_id).filter(Boolean)
      if (stateIds.length) qb = qb.whereIn('destination_state_id', stateIds)
    }

    if (filters.origin_zone?.length) {
      const zones = filters.origin_zone.map((z) => z.value).filter(Boolean)
      if (zones.length) qb = qb.whereIn('os.zone', zones)
    }

    if (filters.destination_zone?.length) {
      const zones = filters.destination_zone.map((z) => z.value).filter(Boolean)
      if (zones.length) qb = qb.whereIn('ds.zone', zones)
    }

    if (filters.weight) {
      const [min, max] = filters.weight.map((v) => (v ? Number(v) : null))
      if (min != null) qb = qb.where('total_estimated_lbs', '>=', min)
      if (max != null) qb = qb.where('total_estimated_lbs', '<=', max)
    }

    if (filters.planned_date) {
      const [start, end] = filters.planned_date
      if (start && end) {
        qb = qb.where('planned_first_day', '<=', end).where('planned_last_day', '>=', start)
      } else if (end) {
        qb = qb.whereRaw('NOT (planned_first_day > ?)', [end])
      } else if (start) {
        qb = qb.whereRaw('NOT (planned_last_day < ?)', [start])
      }
    }

    if (filters.planned_start) {
      const [start, end] = filters.planned_start
      if (start && end) {
        qb = qb
          .whereRaw('NOT planned_first_day > ?', [end])
          .whereRaw('NOT planned_first_day < ?', [start])
      } else if (end) {
        qb = qb.whereRaw('NOT (planned_first_day > ?)', [end])
      } else if (start) {
        qb = qb.whereRaw('NOT (planned_first_day < ?)', [start])
      }
    }

    if (filters.planned_end) {
      const [start, end] = filters.planned_end
      if (start && end) {
        qb = qb
          .whereRaw('NOT planned_last_day > ?', [end])
          .whereRaw('NOT planned_last_day < ?', [start])
      } else if (end) {
        qb = qb.whereRaw('NOT (planned_last_day > ?)', [end])
      } else if (start) {
        qb = qb.whereRaw('NOT (planned_last_day < ?)', [start])
      }
    }

    if (filters.TripStatus_id?.length) {
      const ids = filters.TripStatus_id.map((s) => s.value).filter(Boolean)
      if (ids.length) qb = qb.whereIn(`${TRIPS_TABLE}.TripStatus_id`, ids)
    }

    if (filters.internal_status?.length) {
      const statuses = filters.internal_status.map((s) => s.value).filter(Boolean)
      if (statuses.length) qb = qb.whereIn('internal_status', statuses)
    }

    if (filters.planner_id?.length) {
      const ids = filters.planner_id.map((p) => p.value).filter(Boolean)
      if (ids.length) qb = qb.whereIn('created_by_id', ids)
    }

    if (filters.dispatcher_id?.length) {
      const ids = filters.dispatcher_id.map((d) => d.value).filter(Boolean)
      if (ids.length) qb = qb.whereIn(`${TRIPS_TABLE}.dispatcher_id`, ids)
    }
  }

  if (query.sortBy?.order) {
    qb = qb.orderBy(query.sortBy.value, query.sortBy.order.toUpperCase() as 'ASC' | 'DESC')
  }

  qb = qb.limit(100)

  const trips = await qb

  // Fetch notes for each trip and attach
  const tripIds = trips.map((t) => t.id as number)
  if (tripIds.length === 0) return trips

  const notes = await db(NOTES_TABLE).whereIn('tripId', tripIds)
  const notesByTrip: Record<number, unknown[]> = {}
  for (const note of notes) {
    const tid = note.tripId as number
    if (!notesByTrip[tid]) notesByTrip[tid] = []
    notesByTrip[tid].push(note)
  }

  return trips.map((trip) => ({
    ...trip,
    notes: notesByTrip[trip.id as number] ?? [],
  }))
}

/** Fetch a single trip with its activities and notes. */
export async function findTripById(db: Knex, id: number) {
  const trip = await db(TRIPS_TABLE)
    .select(
      `${TRIPS_TABLE}.*`,
      'ts.status as status_status',
      'ts.status_id as status_id',
      'drv.driver_name',
      'drv.agent_code',
      'os.geo_code as origin_geo_code',
      'os.geo_name as origin_geo_name',
      'ds.geo_code as destination_geo_code',
      'ds.geo_name as destination_geo_name',
      'pu.first_name as planner_first_name',
      'pu.last_name as planner_last_name',
      'du.first_name as dispatcher_first_name',
      'du.last_name as dispatcher_last_name',
    )
    .leftJoin('MasterTripStatus as ts', `${TRIPS_TABLE}.TripStatus_id`, 'ts.status_id')
    .leftJoin('v_longhaul_drivers as drv', `${TRIPS_TABLE}.driver_id`, 'drv.driver_id')
    .leftJoin('v_longhaul_states as os', `${TRIPS_TABLE}.origin_state_id`, 'os.id')
    .leftJoin('v_longhaul_states as ds', `${TRIPS_TABLE}.destination_state_id`, 'ds.id')
    .leftJoin('v_longhaul_salesman as pu', `${TRIPS_TABLE}.created_by_id`, 'pu.code')
    .leftJoin('v_longhaul_salesman as du', `${TRIPS_TABLE}.dispatcher_id`, 'du.code')
    .where(`${TRIPS_TABLE}.id`, id)
    .first()

  if (!trip) return null

  const [activities, notes] = await Promise.all([
    db(ACTIVITIES_TABLE)
      .select(
        `${ACTIVITIES_TABLE}.*`,
        'at.code as activityType_code',
        'at.name as activityType_name',
        'at.abbreviation as activityType_abbreviation',
      )
      .leftJoin('Longhaul_ActivityType as at', `${ACTIVITIES_TABLE}.ActivityType_code`, 'at.code')
      .where(`${ACTIVITIES_TABLE}.TripMaster_id`, id),
    db(NOTES_TABLE).where('tripId', id),
  ])

  return { ...trip, activities, notes }
}

/** Upsert a trip record. If tripData.id is provided, update; otherwise insert. */
export async function saveTrip(db: Knex, tripData: Record<string, unknown>) {
  const { id, ...fields } = tripData as { id?: number } & Record<string, unknown>

  if (id) {
    await db(TRIPS_TABLE)
      .where('id', id)
      .update({ ...fields, updated_date: new Date() })
    return db(TRIPS_TABLE).where('id', id).first()
  } else {
    const result = await db(TRIPS_TABLE).insert({
      ...fields,
      created_date: new Date(),
      updated_date: new Date(),
    })
    // mssql returns identity value in result[0]
    const newId = Array.isArray(result) ? result[0] : result
    return db(TRIPS_TABLE).where('id', newId).first()
  }
}

/** Update only the TripStatus_id for a trip. */
export async function updateTripStatus(db: Knex, tripId: number, statusId: number) {
  return db(TRIPS_TABLE).where('id', tripId).update({ TripStatus_id: statusId })
}

/** Cancel a trip by setting internal_status = 'canceled'. */
export async function cancelTrip(db: Knex, tripId: number, userId?: number) {
  return db(TRIPS_TABLE)
    .where('id', tripId)
    .update({
      internal_status: 'canceled',
      updated_date: new Date(),
      updated_by_id: userId ?? null,
    })
}

/** Update the computed summary fields on a trip (weight, dates, state IDs, etc). */
export async function updateTripSummary(
  db: Knex,
  tripId: number,
  summaryData: Record<string, unknown>,
) {
  return db(TRIPS_TABLE)
    .where('id', tripId)
    .update({ ...summaryData, updated_date: new Date() })
}

// ---------------------------------------------------------------------------
// updateTripSummaryInfo — port of legacy TripService.updateTripSummaryInfo.
// Reads the trip's current activities, joins them with shipment data, and
// writes derived summary fields (weights, linehaul, dates, counts, state ids)
// back to the TripMaster row. Idempotent.
// ---------------------------------------------------------------------------

const LOAD_ACTIVITY_CODES = ['LOAD', 'R19O']
const ONE_DAY_MS = 1000 * 60 * 60 * 24

function daysBetween(date1: unknown, date2: unknown): number {
  if (!date1 || !date2) return 0
  const ms = Math.abs(new Date(date1 as string).getTime() - new Date(date2 as string).getTime())
  return Math.round(ms / ONE_DAY_MS) + 1
}

function sumShipmentField(
  activities: Array<Record<string, unknown>>,
  shipmentsMap: Record<number, Record<string, unknown>>,
  field: string,
): number {
  return activities.reduce((acc, a) => {
    const shipment = shipmentsMap[a['order_num'] as number]
    return acc + (Number(shipment?.[field]) || 0)
  }, 0)
}

function effectiveStart(a: Record<string, unknown>): number {
  const v = (a['actual_date'] || a['estimated_date'] || a['planned_start']) as string | undefined
  return v ? new Date(v).getTime() : 0
}

function effectiveEnd(a: Record<string, unknown>): number {
  const v = (a['actual_date'] || a['estimated_date'] || a['planned_end']) as string | undefined
  return v ? new Date(v).getTime() : 0
}

/**
 * Recompute and persist trip-level summary fields from the activities currently
 * assigned to the trip. No-op (returns 0 updated rows) if the trip has no
 * activities — matches legacy behavior of leaving stale values in place.
 */
export async function updateTripSummaryInfo(db: Knex, tripId: number): Promise<number> {
  const activities: Array<Record<string, unknown>> = await db(ACTIVITIES_TABLE)
    .select(
      `${ACTIVITIES_TABLE}.*`,
      'at.code as activityType_code',
      'at.name as activityType_name',
      'at.abbreviation as activityType_abbreviation',
    )
    .leftJoin('Longhaul_ActivityType as at', `${ACTIVITIES_TABLE}.ActivityType_code`, 'at.code')
    .where(`${ACTIVITIES_TABLE}.TripMaster_id`, tripId)

  if (activities.length === 0) return 0

  const orderNums = [...new Set(activities.map((a) => a['order_num'] as number).filter(Boolean))]
  const shipments = orderNums.length ? await findShipmentsByIds(db, orderNums) : []
  const shipmentsMap: Record<number, Record<string, unknown>> = {}
  for (const s of shipments) {
    shipmentsMap[s.order_num as number] = s as Record<string, unknown>
  }

  const loads = activities.filter((a) => {
    const code = (a['activityType_code'] || a['ActivityType_code']) as string | undefined
    return code != null && LOAD_ACTIVITY_CODES.includes(code)
  })

  const vipCount = new Set(
    orderNums.filter((n) => {
      const s = shipmentsMap[n]
      return s?.['vip'] === 'Y' && s?.['supervip'] !== 'Y'
    }),
  ).size
  const supervipCount = new Set(
    orderNums.filter((n) => shipmentsMap[n]?.['supervip'] === 'Y'),
  ).size

  const originActivity = [...activities].sort((a, b) => effectiveStart(a) - effectiveStart(b))[0]
  const destinationActivity = [...activities].sort((a, b) => effectiveEnd(b) - effectiveEnd(a))[0]

  const originShipment = originActivity
    ? (shipmentsMap[originActivity['order_num'] as number] ?? {})
    : {}
  const destinationShipment = destinationActivity
    ? (shipmentsMap[destinationActivity['order_num'] as number] ?? {})
    : {}

  const plannedFirstDay =
    originActivity?.['actual_date'] ||
    originActivity?.['estimated_date'] ||
    originActivity?.['planned_start'] ||
    null
  const plannedLastDay =
    destinationActivity?.['actual_date'] ||
    destinationActivity?.['estimated_date'] ||
    destinationActivity?.['planned_end'] ||
    null

  const summary: Record<string, unknown> = {
    origin_state_id:
      (originShipment['origin_state'] as Record<string, unknown> | undefined)?.['state_id'] ?? null,
    destination_state_id:
      (destinationShipment['destination_state'] as Record<string, unknown> | undefined)?.[
        'state_id'
      ] ?? null,
    total_estimated_lbs: sumShipmentField(loads, shipmentsMap, 'total_est_wt'),
    total_actual_lbs: sumShipmentField(loads, shipmentsMap, 'total_actual_wt'),
    total_estimated_linehaul_usd: sumShipmentField(loads, shipmentsMap, 'line_haul'),
    total_actual_linehaul_usd: sumShipmentField(loads, shipmentsMap, 'line_haul'),
    total_days: daysBetween(plannedFirstDay, plannedLastDay),
    planned_first_day: plannedFirstDay,
    planned_last_day: plannedLastDay,
    load_activity_count: loads.length,
    vip_count: vipCount,
    supervip_count: supervipCount,
  }

  return db(TRIPS_TABLE)
    .where('id', tripId)
    .update({ ...summary, updated_date: new Date() })
}

/** Return all rows from MasterTripStatus. */
export async function getTripStatuses(db: Knex) {
  return db('MasterTripStatus').select('*')
}

/** Insert a new note into TripNotes. */
export async function createNote(
  db: Knex,
  note: { tripId: number; note: string; createdBy: number; type?: string },
) {
  return db(NOTES_TABLE).insert({
    ...note,
    type: note.type ?? 'DISPATCH',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

/** Update the text of an existing note. */
export async function patchNote(db: Knex, tripId: number, noteId: number, text: string) {
  return db(NOTES_TABLE).where({ tripId, id: noteId }).update({ note: text, updatedAt: new Date() })
}
