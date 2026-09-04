// ---------------------------------------------------------------------------
// Arrival windows on a longhaul activity.
//
// Customer service tells the customer the day before an activity that the crew
// will arrive between, say, 8:00 and 10:00. Those times are LOCAL to the
// activity's address, so the stored shape is three fields:
//
//   arrival_window_start  varchar(5)  'HH:mm' wall clock
//   arrival_window_end    varchar(5)  'HH:mm' wall clock
//   arrival_window_tz     varchar(64) IANA zone id
//
// WHY STRINGS AND NOT `time` / a timestamp:
//
//   1. The `mssql` driver hands a `time` column back as a 1970-01-01 `Date`.
//      This table has already cost the team one full round of Date-coercion
//      bugs (#619 / #622, see longhaul-date-only.ts) — a fixed-width string is
//      the same lesson applied one column over: no timezone math on the wire,
//      no timezone math in the driver, exactly one place that converts.
//   2. A window is a wall clock, not an instant. "8am local" survives a change
//      to the tz database; a stored UTC instant does not. The UTC instants are
//      DERIVED on read (`enrichArrivalWindow`) and never persisted.
//
// The window has no date column of its own. Its anchor is the activity's own
// `estimated_date ?? planned_start`, resolved at read time, so moving the ETA
// carries the window with it rather than leaving a stale one behind.
//
// VALIDATION IS DELIBERATELY THIN — `end >= start`, well-formed times, and a
// zone. It does NOT compare the window to any date column. The last guard on
// this table that related two columns to each other (`isInvertedSpan`) broke 8
// production activities and blocked their trips from saving at all; see
// `isImplausibleDateOnly` for that post-mortem. Do not add one here.
// ---------------------------------------------------------------------------

import { resolveTimeZone } from './longhaul-arrival-timezone'

/** The three legacy columns that make up an arrival window. */
export const ARRIVAL_WINDOW_COLUMNS = [
  'arrival_window_start',
  'arrival_window_end',
  'arrival_window_tz',
] as const

/** 24-hour `HH:mm`. Anchored both ends — `8:00` and `08:00:00` are rejected. */
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `YYYY-MM-DD`, optionally followed by a time we ignore (the DB stores naive midnight). */
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/

export interface ArrivalWindow {
  start: string
  end: string
  timeZone: string
}

/** Normalize a wall-clock time to `HH:mm`, or null when it isn't one. */
export function parseHhMm(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  return HHMM_RE.test(raw) ? raw : null
}

/** Minutes past local midnight for an `HH:mm`. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/** True when the string names a zone this runtime's ICU actually knows. */
export function isKnownTimeZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Validate the arrival-window fields of a patch.
 *
 * Returns an error message, or null when the patch is acceptable. The rules:
 *
 *   - All three fields or none. A window with no zone cannot be turned into a
 *     send time, so storing one would be storing something unusable; a window
 *     with only one end is meaningless.
 *   - Times are `HH:mm`, and `end >= start` (a single-instant window is fine).
 *   - The zone is one this runtime recognizes.
 *
 * `present` is what the caller actually sent — a patch that omits all three
 * leaves the stored window alone and is always valid.
 */
export function validateArrivalWindow(patch: Record<string, unknown>): string | null {
  const touched = ARRIVAL_WINDOW_COLUMNS.filter((c) => patch[c] !== undefined)
  if (touched.length === 0) return null

  const start = patch['arrival_window_start']
  const end = patch['arrival_window_end']
  const tz = patch['arrival_window_tz']

  const isBlank = (v: unknown) => v === null || v === '' || v === undefined
  // Clearing the window: every field explicitly blanked.
  if (isBlank(start) && isBlank(end) && isBlank(tz)) return null

  if (touched.length !== ARRIVAL_WINDOW_COLUMNS.length) {
    return 'arrival window requires arrival_window_start, arrival_window_end and arrival_window_tz together'
  }
  if (isBlank(start) || isBlank(end)) {
    return 'arrival window requires both a start and an end time'
  }
  if (isBlank(tz)) {
    return 'arrival window requires a time zone — the window is a local wall clock and is unusable without one'
  }

  const parsedStart = parseHhMm(start)
  const parsedEnd = parseHhMm(end)
  if (!parsedStart)
    return `arrival_window_start must be HH:mm (24-hour), received "${String(start)}"`
  if (!parsedEnd) return `arrival_window_end must be HH:mm (24-hour), received "${String(end)}"`
  if (minutesOf(parsedEnd) < minutesOf(parsedStart)) {
    return 'arrival_window_end must not be earlier than arrival_window_start'
  }
  if (!isKnownTimeZone(tz)) return `Unknown time zone "${String(tz)}"`

  return null
}

/**
 * The zone's offset from UTC, in minutes, at a given instant.
 *
 * Formats the instant INTO the zone and reads the wall clock back out, which is
 * the only offset source that is correct across DST without shipping a tz
 * database. Node carries full ICU, so every IANA id resolves.
 */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return (asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000
}

/**
 * The UTC instant of a local wall-clock time on a calendar day in a zone.
 *
 * Two passes: guess by treating the wall clock as if it were UTC, read the
 * offset that instant actually has, then re-read the offset at the corrected
 * instant. The second pass is what makes the DST transition days come out
 * right — on those days the offset before and after the jump differ, and the
 * first guess can land on the wrong side of it.
 */
export function localToUtc(dateOnly: string, hhmm: string, timeZone: string): Date | null {
  const date = DATE_PREFIX_RE.exec(dateOnly.trim())
  const time = parseHhMm(hhmm)
  if (!date || !time || !isKnownTimeZone(timeZone)) return null

  const [, y, m, d] = date
  const [hh, mm] = time.split(':')
  const asIfUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))

  const firstOffset = zoneOffsetMinutes(timeZone, new Date(asIfUtc))
  let utc = asIfUtc - firstOffset * 60000
  const secondOffset = zoneOffsetMinutes(timeZone, new Date(utc))
  if (secondOffset !== firstOffset) utc = asIfUtc - secondOffset * 60000

  return new Date(utc)
}

/**
 * The zone's short label at an instant — `EDT` vs `EST`, which depends on the
 * date. Derived server-side so no client ever has to work out whether daylight
 * time was in effect.
 */
export function zoneAbbreviation(timeZone: string, at: Date): string | null {
  if (!isKnownTimeZone(timeZone)) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
    at,
  )
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
}

/** The calendar day an activity's window applies to. */
export function arrivalWindowDate(activity: Record<string, unknown>): string | null {
  for (const column of ['estimated_date', 'planned_start'] as const) {
    const value = activity[column]
    if (typeof value === 'string') {
      const m = DATE_PREFIX_RE.exec(value.trim())
      if (m) return `${m[1]}-${m[2]}-${m[3]}`
    } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
      // Stored values are naive UTC midnight — read the UTC day, not the local
      // one, or every activity west of UTC reports the previous day.
      return value.toISOString().slice(0, 10)
    }
  }
  return null
}

export interface ArrivalWindowDerived {
  /** The calendar day the window applies to (`estimated_date ?? planned_start`). */
  arrival_window_date: string | null
  /** `EDT` / `PST` / … at that date, or null when there is no window. */
  arrival_window_tz_label: string | null
  /** ISO instants the automation should schedule against. */
  arrival_window_start_utc: string | null
  arrival_window_end_utc: string | null
  /** What the resolver would pick for this address, for the popover's prefill. */
  arrival_window_tz_suggested: string | null
  arrival_window_tz_confidence: 'confident' | 'likely' | 'unknown'
  arrival_window_tz_reason: string
}

/**
 * Derive everything a consumer needs from the three stored columns, without
 * asking any consumer to do timezone math.
 *
 * Safe on activities from a tenant whose table has not been provisioned yet:
 * absent columns read as `undefined` and every derived field comes back null.
 */
export function deriveArrivalWindow(activity: Record<string, unknown>): ArrivalWindowDerived {
  const suggestion = resolveTimeZone({ zip: activity['zip'], state: activity['state'] })
  const date = arrivalWindowDate(activity)
  const start = parseHhMm(activity['arrival_window_start'])
  const end = parseHhMm(activity['arrival_window_end'])
  const tz = activity['arrival_window_tz']

  const base: ArrivalWindowDerived = {
    arrival_window_date: date,
    arrival_window_tz_label: null,
    arrival_window_start_utc: null,
    arrival_window_end_utc: null,
    arrival_window_tz_suggested: suggestion.timeZone,
    arrival_window_tz_confidence: suggestion.confidence,
    arrival_window_tz_reason: suggestion.reason,
  }

  if (!start || !end || typeof tz !== 'string' || !isKnownTimeZone(tz) || !date) return base

  const startUtc = localToUtc(date, start, tz)
  const endUtc = localToUtc(date, end, tz)
  return {
    ...base,
    arrival_window_tz_label: startUtc ? zoneAbbreviation(tz, startUtc) : null,
    arrival_window_start_utc: startUtc ? startUtc.toISOString() : null,
    arrival_window_end_utc: endUtc ? endUtc.toISOString() : null,
  }
}

/** `deriveArrivalWindow` merged onto the activity, for the trip-fetch read path. */
export function enrichActivityArrivalWindow<T extends Record<string, unknown>>(
  activity: T,
): T & ArrivalWindowDerived {
  return { ...activity, ...deriveArrivalWindow(activity) }
}
