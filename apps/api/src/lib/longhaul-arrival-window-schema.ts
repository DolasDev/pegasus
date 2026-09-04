// ---------------------------------------------------------------------------
// Lazy provisioning of the arrival-window columns on LongDistanceDispatchActivity.
//
// The legacy MSSQL schema is per-tenant and there is no migration tooling for
// it, so these three columns are added the way the repo already adds columns to
// DriverConfirmedAvailability: an idempotent `IF COL_LENGTH … ALTER TABLE ADD`
// run lazily by the write path. A tenant that never sets an arrival window
// never gets the columns, and reads tolerate their absence
// (`deriveArrivalWindow` returns nulls) — so provisioning is driven entirely by
// use.
//
// TWO RULES, BOTH LEARNED THE HARD WAY:
//
// 1. RUN THIS IN ITS OWN executeSql CALL. SQL Server resolves column references
//    at PARSE time, so a batch that both adds a column and names it raises
//    `Invalid column name` before the ALTER ever commits. This is exactly the
//    trap documented on CONFIRMED_SQL in handlers/longhaul-cloud/driver-planning.ts.
//
// 2. THE HISTORY TABLE MOVES WITH THE PARENT. LongDistanceDispatchActivity has
//    an AFTER DELETE trigger that copies the deleted row into
//    LongDistanceDispatchActivityHistory. If that trigger is written as
//    `INSERT INTO …History SELECT * FROM deleted` — no column list — then
//    widening only the parent breaks EVERY activity delete, and with it every
//    trip save that drops an activity. Widening both tables by the same columns
//    in the same order keeps such a trigger working, so this SQL does both.
//    The history table is guarded by OBJECT_ID because it is not present on
//    every tenant.
//
// Not soft-failed: if provisioning cannot happen the window cannot be stored,
// and the caller should see that rather than silently drop the user's input.
// ---------------------------------------------------------------------------

import { executeSql } from './mssql-executor-client'
import { ARRIVAL_WINDOW_COLUMNS } from './longhaul-arrival-window'
import { logger } from './logger'

const ACTIVITY_TABLE = 'LongDistanceDispatchActivity'
const HISTORY_TABLE = 'LongDistanceDispatchActivityHistory'

/** `varchar` widths: `HH:mm` is always 5, an IANA id comfortably fits 64. */
const COLUMN_TYPES: Record<(typeof ARRIVAL_WINDOW_COLUMNS)[number], string> = {
  arrival_window_start: 'varchar(5)',
  arrival_window_end: 'varchar(5)',
  arrival_window_tz: 'varchar(64)',
}

function addColumnGuards(table: string): string {
  return ARRIVAL_WINDOW_COLUMNS.map(
    (column) =>
      `  IF COL_LENGTH('${table}','${column}') IS NULL ALTER TABLE ${table} ADD ${column} ${COLUMN_TYPES[column]} NULL;`,
  ).join('\n')
}

export const ENSURE_ARRIVAL_WINDOW_COLUMNS_SQL = `
SET XACT_ABORT ON;
${addColumnGuards(ACTIVITY_TABLE)}
IF OBJECT_ID('${HISTORY_TABLE}', 'U') IS NOT NULL
BEGIN
${addColumnGuards(HISTORY_TABLE)}
END
`

/**
 * Connection strings already provisioned in this Lambda container.
 *
 * Best-effort only — a cold container simply re-runs the guards, which are
 * idempotent. Correctness never depends on the memo, just round trips.
 */
const provisioned = new Set<string>()

/** Test seam — a fresh container's view of the world. */
export function resetArrivalWindowProvisioningCache(): void {
  provisioned.clear()
}

/** True when a patch actually sets or clears an arrival window. */
export function patchTouchesArrivalWindow(patch: Record<string, unknown>): boolean {
  return ARRIVAL_WINDOW_COLUMNS.some((column) => patch[column] !== undefined)
}

/** True when any activity in a trip-save payload carries arrival-window fields. */
export function activitiesTouchArrivalWindow(activities: Array<Record<string, unknown>>): boolean {
  return activities.some(patchTouchesArrivalWindow)
}

/**
 * Ensure the arrival-window columns exist on this tenant's legacy database.
 *
 * MUST be awaited before — and separately from — any statement that names the
 * columns. See rule 1 above.
 */
export async function ensureArrivalWindowColumns(connectionString: string): Promise<void> {
  if (provisioned.has(connectionString)) return
  await executeSql(connectionString, ENSURE_ARRIVAL_WINDOW_COLUMNS_SQL)
  provisioned.add(connectionString)
  logger.info('longhaul arrival-window columns ensured')
}
