// ---------------------------------------------------------------------------
// Lazy provisioning of the arrival-window columns on LongDistanceDispatchActivity.
//
// The legacy MSSQL schema is per-tenant and there is no migration tooling for
// it, so these three columns are added the way the repo already adds columns to
// DriverConfirmedAvailability: an idempotent `IF COL_LENGTH … ALTER TABLE ADD`
// run lazily by the write path. A tenant that never sets an arrival window
// never gets the columns, and reads tolerate their absence
// (`deriveArrivalWindow` returns nulls) — so provisioning is driven by use.
//
// RUN THIS IN ITS OWN executeSql CALL. SQL Server resolves column references at
// PARSE time, so a batch that both adds a column and names it raises
// `Invalid column name` before the ALTER ever commits. This is the same trap
// documented on CONFIRMED_SQL in handlers/longhaul-cloud/driver-planning.ts.
//
// WHY THE PARENT TABLE ONLY — verified against prod 2026-09-04.
//
// `LongDistanceDispatchActivity` carries three ENABLED triggers on NWI
// (insert / update / delete; Quality Move Management has none at all). Widening
// a table under a trigger is only safe depending on how that trigger moves rows,
// so all three bodies were read before this shipped:
//
//   - NONE of them contains a `SELECT *`.
//   - The only INSERT is the delete trigger's copy into
//     `LongDistanceDispatchActivityHistory`, and it names all 25 columns
//     explicitly on BOTH sides.
//   - The insert and update triggers only `UPDATE sales SET <named columns>`.
//
// That matters because the history table is exactly the shape that WOULD have
// broken under a positional insert: 26 columns to the parent's 24, with trailing
// audit columns `date_created` / `created_by`. Appending to the parent alone
// would then have shifted `'08:00'` into a `datetime` and failed every activity
// delete — and so every trip save that drops one. The explicit column list is
// what makes this safe.
//
// It is also why the history table is deliberately NOT widened here. The trigger
// names its columns, so it would never populate them; the result would be three
// permanently-NULL columns on an audit table. The cost is that a deleted
// activity's arrival window is not preserved in history. Accepted: closing that
// gap means editing a live legacy trigger that also writes to `sales`, which is
// far riskier than this feature warrants.
//
// ANY future column added to this table must re-read the triggers first — an
// explicit column list today is not a guarantee for tomorrow, and the legacy VB
// app owns these triggers. Note too that the history table is DELETE-ONLY: there
// is no update history, so a bad UPDATE here is unrecoverable from the DB itself.
// ---------------------------------------------------------------------------

import { executeSql } from './mssql-executor-client'
import { ARRIVAL_WINDOW_COLUMNS } from './longhaul-arrival-window'
import { logger } from './logger'

const ACTIVITY_TABLE = 'LongDistanceDispatchActivity'

/** `varchar` widths: `HH:mm` is always 5, an IANA id comfortably fits 64. */
const COLUMN_TYPES: Record<(typeof ARRIVAL_WINDOW_COLUMNS)[number], string> = {
  arrival_window_start: 'varchar(5)',
  arrival_window_end: 'varchar(5)',
  arrival_window_tz: 'varchar(64)',
}

export const ENSURE_ARRIVAL_WINDOW_COLUMNS_SQL = `
SET XACT_ABORT ON;
${ARRIVAL_WINDOW_COLUMNS.map(
  (column) =>
    `IF COL_LENGTH('${ACTIVITY_TABLE}','${column}') IS NULL ALTER TABLE ${ACTIVITY_TABLE} ADD ${column} ${COLUMN_TYPES[column]} NULL;`,
).join('\n')}
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
 * columns. See the parse-time rule above.
 */
export async function ensureArrivalWindowColumns(connectionString: string): Promise<void> {
  if (provisioned.has(connectionString)) return
  await executeSql(connectionString, ENSURE_ARRIVAL_WINDOW_COLUMNS_SQL)
  provisioned.add(connectionString)
  logger.info('longhaul arrival-window columns ensured')
}
