// ---------------------------------------------------------------------------
// Longhaul activities repository — Knex queries against LongDistanceDispatchActivity
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'

const ACTIVITIES_TABLE = 'LongDistanceDispatchActivity'

/** Fetch all activities for a trip, including their activity type details. */
export async function findActivitiesByTripId(db: Knex, tripId: number) {
  return db(ACTIVITIES_TABLE)
    .select(
      `${ACTIVITIES_TABLE}.*`,
      'at.code as activityType_code',
      'at.name as activityType_name',
      'at.abbreviation as activityType_abbreviation',
      'at.isPerformedAtOrigin',
      'at.isPerformedAtDestination',
      'at.sequencePriority',
    )
    .leftJoin('Longhaul_ActivityType as at', `${ACTIVITIES_TABLE}.ActivityType_code`, 'at.code')
    .where(`${ACTIVITIES_TABLE}.TripMaster_id`, tripId)
}

/** Update an existing activity by its primary key (id column). */
export async function saveActivity(
  db: Knex,
  activityId: number,
  patch: Record<string, unknown>,
  userId?: number,
) {
  return db(ACTIVITIES_TABLE)
    .where('id', activityId)
    .update({ ...patch, modified_by: userId ?? null, updated_at: new Date() })
}

/** Insert a new activity row. Returns the new row's id. */
export async function insertActivity(db: Knex, activity: Record<string, unknown>) {
  const result = await db(ACTIVITIES_TABLE).insert({
    ...activity,
    created_at: new Date(),
    updated_at: new Date(),
  })
  return Array.isArray(result) ? result[0] : result
}

/** Bulk-update status fields for all activities on a trip. */
export async function updateActivitiesStatus(
  db: Knex,
  tripId: number,
  statusId: number,
  status: string,
  userId?: number,
) {
  return db(ACTIVITIES_TABLE)
    .where('TripMaster_id', tripId)
    .update({
      trip_status_id: statusId,
      status,
      modified_by: userId ?? null,
      updated_at: new Date(),
    })
}

/** Delete activities by their id list (hard delete). */
export async function removeActivities(db: Knex, activityIds: number[], userId?: number) {
  if (activityIds.length === 0) return
  // Touch updated_by before deleting (audit trail)
  await db(ACTIVITIES_TABLE)
    .whereIn('id', activityIds)
    .update({ modified_by: userId ?? null, updated_at: new Date() })
  return db(ACTIVITIES_TABLE).whereIn('id', activityIds).delete()
}

/** Delete all activities for a trip (used by cancelTrip). */
export async function cancelTripActivities(db: Knex, tripId: number, userId?: number) {
  await db(ACTIVITIES_TABLE)
    .where('TripMaster_id', tripId)
    .update({
      modified_by: userId ?? null,
      updated_at: new Date(),
    })
  return db(ACTIVITIES_TABLE).where('TripMaster_id', tripId).delete()
}
