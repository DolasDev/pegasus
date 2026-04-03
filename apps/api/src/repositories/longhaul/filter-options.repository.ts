// ---------------------------------------------------------------------------
// Longhaul filter-options repository — saved shipment filters and move types
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'

const FILTER_TABLE = 'longhaul_shipment_filter'
const USER_PREFERENCES_TABLE = 'longhaul_user_preferences'

/** Query filter options (move types). */
export async function getFilterOptions(db: Knex) {
  const args = process.env['MOVE_TYPES_WHERE'] ?? '1=1'
  const moveTypes = await db('MoveType')
    .whereRaw(args)
    .orderBy('move_type_desc', 'asc')
    .select('move_type_desc', 'move_type')

  return {
    moveType: moveTypes.map(({ move_type_desc, move_type }) => ({
      value: move_type as string,
      label: move_type_desc as string,
    })),
  }
}

/** Return all saved filters owned by the given user code. */
export async function getSavedFiltersForUser(db: Knex, userCode: string | number) {
  return db(FILTER_TABLE).where('owner_code', userCode).orderBy('name', 'asc').select('*')
}

/** Insert or update a filter record. */
export async function saveFilter(
  db: Knex,
  filterData: {
    name: string
    owner_code: string | number
    query: string
    is_public?: boolean
  },
) {
  const result = await db(FILTER_TABLE).insert({
    ...filterData,
    is_public: filterData.is_public ?? false,
  })
  const newId = Array.isArray(result) ? result[0] : result
  return db(FILTER_TABLE).where('filter_id', newId).first()
}

/** Set the default filter for a user (updates user preferences). */
export async function setDefaultFilter(db: Knex, filterId: number, userId: string | number) {
  const existing = await db(USER_PREFERENCES_TABLE).where('user_id', userId).first()

  if (existing) {
    return db(USER_PREFERENCES_TABLE)
      .where('user_id', userId)
      .update({ default_filter_id: filterId })
  } else {
    return db(USER_PREFERENCES_TABLE).insert({ user_id: userId, default_filter_id: filterId })
  }
}

/** Delete a filter by id. */
export async function deleteFilter(db: Knex, filterId: number) {
  return db(FILTER_TABLE).where('filter_id', filterId).delete()
}

/** Get the default filter for a user (via user preferences). */
export async function getDefaultFilter(db: Knex, userId: string | number) {
  const pref = await db(USER_PREFERENCES_TABLE).where('user_id', userId).first()
  if (!pref?.default_filter_id) return null

  return db(FILTER_TABLE)
    .where('filter_id', pref.default_filter_id as number)
    .first()
}
