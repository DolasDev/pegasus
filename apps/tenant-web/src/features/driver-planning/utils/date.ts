// Pure date arithmetic. Formatting helpers live in ./format-date.ts.

/** Difference between two dates in whole days (second - first), rounded. */
export function datediff(first: Date | string | number, second: Date | string | number): number {
  return Math.round((+new Date(second) - +new Date(first)) / (1000 * 60 * 60 * 24))
}

/** Returns a new Date that is `days` days after `date`. Does not mutate. */
export function addDays(date: Date | string | number, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Collapse a date to the ISO string for UTC midnight of its calendar day, or
 * `null` when the input can't be parsed.
 *
 * This is the canonical key for a Gantt date column. The column header renders
 * via `formatDateShort`, which formats with `timeZone: 'UTC'` — so two values
 * sharing a UTC calendar day render the *same* label. Keying columns by the
 * full timestamp instead made those two values two separate columns showing
 * the same date, and made the exact-match column lookup miss (silently falling
 * back to column 0). Normalize once, here, so the key and the label agree.
 *
 * Unparseable input maps to `null` — the same bucket as a missing date (the
 * "Unknown" column) — rather than throwing, which is what a bare
 * `new Date(x).toISOString()` does on an Invalid Date.
 */
export function toUtcDayKey(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

/**
 * Two dates fall on the same calendar day in local time. Times of day are
 * ignored (only year/month/day are compared). Invalid Date inputs (NaN
 * timestamp, e.g. `new Date(undefined)`) compare as NOT same-day.
 */
export function sameDayCheck(
  a: Date | string | number | null | undefined,
  b: Date | string | number | null | undefined,
): boolean {
  const dayA = new Date(a as Date | string | number)
  const dayB = new Date(b as Date | string | number)
  if (isNaN(dayA.getTime()) || isNaN(dayB.getTime())) return false
  return (
    dayA.getFullYear() === dayB.getFullYear() &&
    dayA.getMonth() === dayB.getMonth() &&
    dayA.getDate() === dayB.getDate()
  )
}
