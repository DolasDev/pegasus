// ---------------------------------------------------------------------------
// Date-only normalization for longhaul activity date columns.
//
// `planned_start`, `planned_end`, `estimated_date` and `actual_date` are
// CALENDAR DAYS, not instants. Everything the legacy DB produces is a naive
// midnight (`2026-08-20 00:00:00`), and the whole Gantt keys columns by UTC
// calendar day.
//
// The tenant-web date pickers used to persist `date.toISOString()` off a
// local-time Date, so a day picked in US-Eastern landed as `05:00:00` — the same
// calendar day, five hours off. Before #534 the Gantt keyed columns by the full
// timestamp, so `2026-08-16T00:00:00Z` (from the planned-date day-walk) and
// `2026-08-16T05:00:00Z` (a saved ETA) rendered as TWO columns both labeled
// "08/16". That is exactly what trip 16426 showed in the legacy app. #534's
// day-key made the Gantt tolerate it, but the stored value is still wrong for
// every other consumer (legacy VB app, reports, exports).
//
// This normalizes at the API boundary, so it holds for tenant-web, trip-save,
// and any SDK caller alike.
//
// A client east of UTC is the one case we cannot fully recover: `toISOString()`
// of its local midnight lands on the PREVIOUS UTC day, and the server has no
// way to know the client's offset. Those inputs are truncated to their UTC day
// and logged, and the real fix is the client sending `YYYY-MM-DD` (which this
// accepts verbatim, with no timezone math at all).
// ---------------------------------------------------------------------------

import { logger } from './logger'

/** Activity columns that carry a calendar day rather than an instant. */
export const DATE_ONLY_COLUMNS = [
  'planned_start',
  'planned_end',
  'estimated_date',
  'actual_date',
] as const

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
/** ISO-ish datetime; group 4 is the timezone designator when present. */
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

export interface DateOnlyResult {
  /** `YYYY-MM-DD 00:00:00`, or null for an empty/unparseable input. */
  value: string | null
  /** True when the input carried a time-of-day that had to be dropped. */
  coerced: boolean
}

/**
 * Collapse a date-only column's value to naive midnight.
 *
 * - `YYYY-MM-DD` is taken verbatim — the unambiguous form, no timezone math.
 * - A datetime WITHOUT an offset keeps its own calendar day (it is already
 *   naive wall-clock, which is what the legacy DB stores).
 * - A datetime WITH an offset (`Z` / `+HH:MM`) is truncated to its **UTC**
 *   calendar day. Correct for clients west of UTC (where local midnight stays
 *   on the same UTC day); a client east of UTC loses a day, which is why
 *   callers should send `YYYY-MM-DD`.
 * - Anything else returns null rather than throwing.
 */
export function toDateOnly(input: unknown): DateOnlyResult {
  if (input === null || input === undefined || input === '') return { value: null, coerced: false }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { value: null, coerced: false }
    return { value: `${utcDayOf(input)} 00:00:00`, coerced: hasTimeOfDay(input) }
  }

  if (typeof input !== 'string') return { value: null, coerced: false }
  const raw = input.trim()

  const dateOnly = DATE_ONLY_RE.exec(raw)
  if (dateOnly) return { value: `${raw} 00:00:00`, coerced: false }

  const dt = DATETIME_RE.exec(raw)
  if (dt) {
    const [, y, m, d, tz] = dt
    // No offset: the wall-clock day is already the intended day.
    if (!tz) return { value: `${y}-${m}-${d} 00:00:00`, coerced: !raw.includes('00:00:00') }
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return { value: null, coerced: false }
    return { value: `${utcDayOf(parsed)} 00:00:00`, coerced: hasTimeOfDay(parsed) }
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return { value: null, coerced: false }
  return { value: `${utcDayOf(parsed)} 00:00:00`, coerced: hasTimeOfDay(parsed) }
}

function utcDayOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function hasTimeOfDay(d: Date): boolean {
  return (
    d.getUTCHours() !== 0 ||
    d.getUTCMinutes() !== 0 ||
    d.getUTCSeconds() !== 0 ||
    d.getUTCMilliseconds() !== 0
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Normalize every date-only column present on `data`, returning a copy.
 * Pure — `onCoerce` is how a caller observes a dropped time-of-day, so this
 * stays usable from `longhaul-trip-save`, which is deliberately I/O-free.
 */
export function mapDateOnlyColumns<T extends Record<string, unknown>>(
  data: T,
  onCoerce?: (column: string, received: unknown, stored: string | null) => void,
): T {
  const out = { ...data }
  for (const col of DATE_ONLY_COLUMNS) {
    if (out[col] === undefined) continue
    const { value, coerced } = toDateOnly(out[col])
    if (coerced) onCoerce?.(col, out[col], value)
    ;(out as Record<string, unknown>)[col] = value
  }
  return out
}

/**
 * `mapDateOnlyColumns` plus a warn per coerced column, so a client still
 * sending timestamps stays visible rather than being silently corrected forever.
 */
export function normalizeDateOnlyColumns<T extends Record<string, unknown>>(
  data: T,
  context: Record<string, unknown> = {},
): T {
  return mapDateOnlyColumns(data, (column, received, stored) => {
    logger.warn('longhaul date-only column carried a time-of-day; truncated to its UTC day', {
      ...context,
      column,
      received: String(received),
      stored,
    })
  })
}

/**
 * True when both bounds are present and the end precedes the start. Compared on
 * the normalized calendar day, so a same-day pair is never inverted.
 *
 * 7 rows in NWI prod carry spans of exactly -364/-365/-728 days — the same
 * MM/DD with the wrong year (e.g. `2021-08-19 -> 2020-08-19`). Those are the
 * rows that render two identically-labeled Gantt columns, since the header
 * shows no year.
 */
export function isInvertedSpan(start: unknown, end: unknown): boolean {
  const s = toDateOnly(start).value
  const e = toDateOnly(end).value
  if (s === null || e === null) return false
  return e < s
}
