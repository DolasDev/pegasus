// ---------------------------------------------------------------------------
// Value normalizers shared by the itinerary row mappers. Pure.
//
// Rows arrive from the mssql executor as JSON, so a DATE/DATETIME column is an
// ISO string with a `Z` (the executor serializes the driver's naive Date) and a
// padded nvarchar keeps its trailing spaces.
// ---------------------------------------------------------------------------

import { toDateOnly } from '../longhaul-date-only'

/**
 * Acts about a SIT stay or the warehouse, not a visit to the customer (A5 §3.3:
 * SIT is a `stay`, not a stop action) — shown with no customer address.
 */
export const STORAGE_CODES: ReadonlySet<string> = new Set(['SITIN', 'SITOUT', 'WHSE'])

/** Sorts after every act the tenant's catalog sequences. */
export const UNKNOWN_SEQUENCE = 999

/** A legacy calendar-day column as `YYYY-MM-DD`, or null. */
export function day(v: unknown): string | null {
  return toDateOnly(v).value?.slice(0, 10) ?? null
}

export function text(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/** The legacy `'Y'`/`'N'` (or bit) flag. */
export function flag(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1
  return typeof v === 'string' && ['Y', '1', 'TRUE'].includes(v.trim().toUpperCase())
}

/** A real legacy id: 0 is the "unassigned" placeholder in every driver column. */
export function realId(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n !== 0 ? n : null
}

/**
 * The `HH:mm` wall-clock of a legacy DATETIME. The column is naive local time,
 * which the executor serializes as if it were UTC — so the UTC fields ARE the
 * wall clock.
 */
export function wallClock(v: unknown): string | null {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
