// ---------------------------------------------------------------------------
// "This week" for the driver dashboard: Monday 00:00 → now in US Central.
//
// The week boundary is a fixed business choice (Steve, 2026-10-15), not a
// per-tenant setting: every current longhaul tenant dispatches on Central time.
// `weekStartDate` is the Chicago-LOCAL Monday as a YYYY-MM-DD string — what the
// SQL compares `actual_last_day` (a date) against. `weekStartInstant` is the
// same moment as a UTC instant, for the API response.
// ---------------------------------------------------------------------------

export const DRIVER_WEEK_TIME_ZONE = 'America/Chicago'

export interface DriverWeek {
  /** Chicago-local Monday, `YYYY-MM-DD`. */
  weekStartDate: string
  /** Monday 00:00 America/Chicago as a UTC instant. */
  weekStartInstant: Date
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
}

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DRIVER_WEEK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})

function chicagoParts(instant: Date) {
  const parts: Record<string, string> = {}
  for (const p of formatter.formatToParts(instant)) parts[p.type] = p.value
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday: parts['weekday'] ?? 'Mon',
  }
}

export function driverWeekFor(now: Date): DriverWeek {
  const local = chicagoParts(now)
  const daysSinceMonday = WEEKDAY_INDEX[local.weekday] ?? 0
  // Calendar arithmetic on a UTC-midnight stand-in for the Chicago date: Date.UTC
  // normalizes day underflow across month/year boundaries, and there are no DST
  // effects on a pure date.
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceMonday))
  const weekStartDate = monday.toISOString().slice(0, 10)

  // Monday 00:00 Chicago. DST changes at 02:00 Sunday, so Monday midnight is never
  // ambiguous. Read Chicago's offset at the UTC-midnight guess and shift by it.
  const guess = monday.getTime()
  const g = chicagoParts(new Date(guess))
  const guessAsLocal = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, g.second)
  const offsetMs = guessAsLocal - guess
  return { weekStartDate, weekStartInstant: new Date(guess - offsetMs) }
}
