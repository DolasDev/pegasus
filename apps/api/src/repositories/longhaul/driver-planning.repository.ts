// ---------------------------------------------------------------------------
// Longhaul driver-planning repository — estimated and confirmed availability
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'

const TRIPS_TABLE = 'TripMaster'
const ACTIVITIES_TABLE = 'LongDistanceDispatchActivity'
const CONFIRMED_TABLE = 'DriverConfirmedAvailability'

export interface DriverRow {
  driver_id: number
  driver_name: string
  agent_code: string | null
  [key: string]: unknown
}

export interface EstimatedAvailability {
  tripId: number
  tripTitle: string | null
  estimatedDate: string | null
  estimatedLocation: string | null
  destinationStateGeoCode: string | null
  destinationStateGeoName: string | null
}

export interface ConfirmedAvailability {
  confirmedDate: string | null
  confirmedLocation: string | null
  notes: string | null
  updatedBy: number | null
  updatedAt: Date | null
}

export interface DriverPlanningRow {
  driverId: number
  driverName: string
  agentCode: string | null
  currentTripId: number | null
  currentTripTitle: string | null
  estimatedAvailableDate: string | null
  estimatedAvailableLocation: string | null
  confirmedAvailableDate: string | null
  confirmedAvailableLocation: string | null
  confirmedNotes: string | null
}

/**
 * Fetch all active drivers with their estimated next availability (derived from
 * the last activity of their most recent non-cancelled trip) and any confirmed
 * availability overrides.
 */
export async function getDriverPlanning(db: Knex): Promise<DriverPlanningRow[]> {
  const drivers: DriverRow[] = await db('v_longhaul_drivers').select('*')

  if (drivers.length === 0) return []

  const driverIds = drivers.map((d) => d.driver_id)

  // For each driver, find their latest non-cancelled trip
  const latestTrips = await db(TRIPS_TABLE)
    .select(
      `${TRIPS_TABLE}.id`,
      `${TRIPS_TABLE}.driver_id`,
      `${TRIPS_TABLE}.trip_title`,
      `${TRIPS_TABLE}.planned_last_day`,
      `${TRIPS_TABLE}.actual_last_day`,
      'ds.geo_code as destination_geo_code',
      'ds.geo_name as destination_geo_name',
    )
    .leftJoin('v_longhaul_states as ds', `${TRIPS_TABLE}.destination_state_id`, 'ds.id')
    .whereIn(`${TRIPS_TABLE}.driver_id`, driverIds)
    .whereNot('internal_status', 'canceled')
    .whereRaw(
      `${TRIPS_TABLE}.id = (SELECT TOP 1 t2.id FROM ${TRIPS_TABLE} t2 WHERE t2.driver_id = ${TRIPS_TABLE}.driver_id AND ISNULL(t2.internal_status, '') <> 'canceled' ORDER BY COALESCE(t2.planned_last_day, t2.created_date) DESC)`,
    )

  // Build a map of driver_id → latest trip info
  const tripByDriver = new Map<number, (typeof latestTrips)[number]>()
  for (const trip of latestTrips) {
    tripByDriver.set(trip.driver_id as number, trip)
  }

  // For trips that have activities, get the last activity's actual/estimated date + location
  const tripIds = latestTrips.map((t) => t.id as number)
  const lastActivities =
    tripIds.length > 0
      ? await db(ACTIVITIES_TABLE)
          .select(
            `${ACTIVITIES_TABLE}.TripMaster_id`,
            `${ACTIVITIES_TABLE}.actual_date`,
            `${ACTIVITIES_TABLE}.estimated_date`,
            `${ACTIVITIES_TABLE}.planned_end`,
            `${ACTIVITIES_TABLE}.city`,
            `${ACTIVITIES_TABLE}.state`,
          )
          .whereIn(`${ACTIVITIES_TABLE}.TripMaster_id`, tripIds)
          .whereRaw(
            `${ACTIVITIES_TABLE}.id = (SELECT TOP 1 a2.id FROM ${ACTIVITIES_TABLE} a2 WHERE a2.TripMaster_id = ${ACTIVITIES_TABLE}.TripMaster_id ORDER BY COALESCE(a2.actual_date, a2.estimated_date, a2.planned_end) DESC)`,
          )
      : []

  const lastActivityByTrip = new Map<number, (typeof lastActivities)[number]>()
  for (const act of lastActivities) {
    lastActivityByTrip.set(act.TripMaster_id as number, act)
  }

  // Fetch confirmed availability overrides
  const confirmed = await getConfirmedAvailabilityBatch(db, driverIds)

  return drivers.map((driver) => {
    const trip = tripByDriver.get(driver.driver_id)
    const lastActivity = trip ? lastActivityByTrip.get(trip.id as number) : undefined
    const conf = confirmed.get(driver.driver_id)

    // Estimated date: last activity's actual or estimated date, falling back to trip's planned_last_day
    const estimatedDate =
      (lastActivity?.actual_date as string | null) ??
      (lastActivity?.estimated_date as string | null) ??
      (lastActivity?.planned_end as string | null) ??
      (trip?.planned_last_day as string | null) ??
      (trip?.actual_last_day as string | null) ??
      null

    // Estimated location: last activity city/state, or trip destination state
    const actCity = lastActivity?.city as string | null
    const actState = lastActivity?.state as string | null
    const estimatedLocation =
      actCity && actState
        ? `${actCity}, ${actState}`
        : (actCity ?? actState ?? (trip?.destination_geo_name as string | null) ?? null)

    return {
      driverId: driver.driver_id,
      driverName: driver.driver_name,
      agentCode: driver.agent_code ?? null,
      currentTripId: (trip?.id as number) ?? null,
      currentTripTitle: (trip?.trip_title as string) ?? null,
      estimatedAvailableDate: estimatedDate,
      estimatedAvailableLocation: estimatedLocation,
      confirmedAvailableDate: conf?.confirmedDate ?? null,
      confirmedAvailableLocation: conf?.confirmedLocation ?? null,
      confirmedNotes: conf?.notes ?? null,
    }
  })
}

/**
 * Ensure the DriverConfirmedAvailability table exists.
 * Called lazily on first write to avoid requiring a migration.
 */
async function ensureConfirmedTable(db: Knex): Promise<void> {
  const exists = await db.schema.hasTable(CONFIRMED_TABLE)
  if (!exists) {
    await db.schema.createTable(CONFIRMED_TABLE, (t) => {
      t.integer('driver_id').primary().notNullable()
      t.string('confirmed_date', 50).nullable()
      t.string('confirmed_location', 255).nullable()
      t.string('notes', 1000).nullable()
      t.integer('updated_by').nullable()
      t.dateTime('updated_at').defaultTo(db.fn.now())
    })
  }
}

/** Fetch confirmed availability for a batch of driver IDs. */
async function getConfirmedAvailabilityBatch(
  db: Knex,
  driverIds: number[],
): Promise<Map<number, ConfirmedAvailability>> {
  const map = new Map<number, ConfirmedAvailability>()

  const exists = await db.schema.hasTable(CONFIRMED_TABLE)
  if (!exists) return map

  const rows = await db(CONFIRMED_TABLE).whereIn('driver_id', driverIds)

  for (const row of rows) {
    map.set(row.driver_id as number, {
      confirmedDate: (row.confirmed_date as string) ?? null,
      confirmedLocation: (row.confirmed_location as string) ?? null,
      notes: (row.notes as string) ?? null,
      updatedBy: (row.updated_by as number) ?? null,
      updatedAt: (row.updated_at as Date) ?? null,
    })
  }

  return map
}

/** Upsert confirmed availability for a driver. */
export async function upsertConfirmedAvailability(
  db: Knex,
  driverId: number,
  data: {
    confirmedDate: string | null
    confirmedLocation: string | null
    notes: string | null
  },
  updatedBy: number | null,
): Promise<void> {
  await ensureConfirmedTable(db)

  const existing = await db(CONFIRMED_TABLE).where('driver_id', driverId).first()

  if (existing) {
    await db(CONFIRMED_TABLE).where('driver_id', driverId).update({
      confirmed_date: data.confirmedDate,
      confirmed_location: data.confirmedLocation,
      notes: data.notes,
      updated_by: updatedBy,
      updated_at: new Date(),
    })
  } else {
    await db(CONFIRMED_TABLE).insert({
      driver_id: driverId,
      confirmed_date: data.confirmedDate,
      confirmed_location: data.confirmedLocation,
      notes: data.notes,
      updated_by: updatedBy,
      updated_at: new Date(),
    })
  }
}
