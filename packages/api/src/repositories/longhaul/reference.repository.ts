// ---------------------------------------------------------------------------
// Longhaul reference repository — drivers, states, zones, users, versions,
// planners, dispatchers, and activity types
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'

/** Fetch all active drivers from v_longhaul_drivers. */
export async function getDrivers(db: Knex) {
  return db('v_longhaul_drivers').select('*')
}

/** Fetch all states from v_longhaul_states. */
export async function getStates(db: Knex) {
  return db('v_longhaul_states').select('*')
}

/** Fetch all zones from v_longhaul_zones. */
export async function getZones(db: Knex) {
  return db('v_longhaul_zones').select('*')
}

/**
 * Fetch planner users.
 * Returns users whose code appears as created_by_id in TripMaster.
 */
export async function getPlanners(db: Knex, plannerCodes?: string[]) {
  let qb = db('v_longhaul_salesman').whereRaw(
    '[v_longhaul_salesman].code IN (SELECT DISTINCT created_by_id FROM TripMaster WHERE created_by_id IS NOT NULL)',
  )
  if (plannerCodes?.length) {
    qb = qb.whereIn('code', plannerCodes)
  }
  return qb.select('*')
}

/**
 * Fetch dispatcher users.
 * Uses DISPATCHER_QUERY env var (default: active='Y').
 */
export async function getDispatchers(db: Knex) {
  const args = process.env['DISPATCHER_QUERY'] ?? "active='Y'"
  return db('v_longhaul_salesman').whereRaw(args).select('*')
}

/** Fetch the latest schema version from longhaul_versions. */
export async function getVersion(db: Knex) {
  return db('longhaul_versions').max('database_version as max').first()
}

/** Fetch all activity types from Longhaul_ActivityType. */
export async function getActivityTypes(db: Knex) {
  return db('Longhaul_ActivityType').select('*')
}

/** Look up a user by Windows username from v_longhaul_salesman. */
export async function getUserByWindowsUsername(db: Knex, username: string) {
  return db('v_longhaul_salesman').whereRaw('LOWER(win_username) = LOWER(?)', [username]).first()
}
