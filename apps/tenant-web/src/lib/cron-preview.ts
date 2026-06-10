// ---------------------------------------------------------------------------
// Frontend cron next-fire preview (Phase 3 Unit 5).
//
// KEEP IN SYNC with the backend matcher in `apps/api/src/lib/cron.ts` —
// tenant-web cannot import from apps/api, so the parser + matcher below are a
// line-for-line port of the server's v1 dialect. If the dialect ever changes
// server-side, this file must change with it, or the preview will lie about
// what the dispatcher will accept/fire.
//
// Supported dialect (v1 — deliberately narrow; everything else parses to null):
//
//   fields:    minute hour day-of-month month day-of-week  (exactly 5)
//   ranges:    minute 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-6 (0=Sunday)
//   operators: `*`, plain numbers, comma lists (`1,15,30`), ranges (`a-b`,
//              inclusive, a <= b — no wraparound), steps (`*/n`, `a-b/n`)
//
// NOT supported (all parse to null — mirrors the server 400):
//   - month/day NAMES (`JAN`, `MON`), `?`, `7` as Sunday, `L` / `W` / `#`,
//     `@hourly`-style macros, seconds/years fields
//   - steps on a bare number (`5/15`) — only `*` and ranges take steps
//   - inverted ranges (`5-1`) — no midnight-wraparound semantics
//
// Day-of-month / day-of-week combination (Vixie OR rule): when BOTH dom and
// dow are restricted (i.e. neither field is exactly `*`), the date matches if
// EITHER matches; otherwise both must match. `*/2` (or any non-`*` text)
// counts as RESTRICTED for this rule. Evaluation is always UTC.
//
// On top of the port, this module adds the one thing the backend deliberately
// doesn't do: forward next-fire computation, by scanning minute-by-minute
// from "now" (capped at 366 days — expressions like `0 0 30 2 *` never fire).
// ---------------------------------------------------------------------------

export type CronSchedule = {
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  daysOfMonth: ReadonlySet<number>
  months: ReadonlySet<number>
  daysOfWeek: ReadonlySet<number>
  /** True unless the day-of-month field text was exactly `*` — drives the
   * dom/dow OR rule (see module header). */
  domRestricted: boolean
  /** True unless the day-of-week field text was exactly `*`. */
  dowRestricted: boolean
}

const INTEGER = /^\d+$/

/**
 * Expands one cron field into the set of matching values, or null when the
 * field uses anything outside the v1 dialect or falls outside [min, max].
 */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    // Empty list entries (`1,,3` / trailing comma) are malformed.
    if (part === '') return null

    let base = part
    let step = 1
    const slash = part.indexOf('/')
    if (slash !== -1) {
      base = part.slice(0, slash)
      const stepText = part.slice(slash + 1)
      // Rejects empty steps (`*/`), non-numeric, multiple slashes, and 0.
      if (!INTEGER.test(stepText)) return null
      step = Number(stepText)
      if (step < 1) return null
      // v1: steps only on `*` or a range — `5/15` is not supported.
      if (base !== '*' && !base.includes('-')) return null
    }

    let lo: number
    let hi: number
    if (base === '*') {
      lo = min
      hi = max
    } else if (base.includes('-')) {
      const bounds = base.split('-')
      if (bounds.length !== 2 || !INTEGER.test(bounds[0]!) || !INTEGER.test(bounds[1]!)) {
        return null
      }
      lo = Number(bounds[0])
      hi = Number(bounds[1])
      // Inverted ranges (`5-1`) have no wraparound semantics in v1.
      if (lo > hi) return null
    } else {
      if (!INTEGER.test(base)) return null
      lo = Number(base)
      hi = lo
    }

    if (lo < min || hi > max) return null
    for (let value = lo; value <= hi; value += step) {
      values.add(value)
    }
  }
  return values
}

/**
 * Parses a 5-field cron expression in the v1 dialect (see module header).
 * Returns null for ANYTHING unsupported, malformed, or out of range — callers
 * treat null as "invalid expression", never as match-all.
 */
export function parseCronExpression(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]

  const minutes = parseField(minute, 0, 59)
  const hours = parseField(hour, 0, 23)
  const daysOfMonth = parseField(dom, 1, 31)
  const months = parseField(month, 1, 12)
  const daysOfWeek = parseField(dow, 0, 6)
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  }
}

/**
 * True when `schedule` fires in the minute containing `date`, evaluated in
 * UTC (seconds/milliseconds are ignored). Vixie dom/dow OR rule — see header.
 */
export function cronMatchesMinute(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getUTCMinutes())) return false
  if (!schedule.hours.has(date.getUTCHours())) return false
  if (!schedule.months.has(date.getUTCMonth() + 1)) return false

  const domMatches = schedule.daysOfMonth.has(date.getUTCDate())
  const dowMatches = schedule.daysOfWeek.has(date.getUTCDay())
  return schedule.domRestricted && schedule.dowRestricted
    ? domMatches || dowMatches
    : domMatches && dowMatches
}

// ---------------------------------------------------------------------------
// Next-fire preview (frontend-only addition)
// ---------------------------------------------------------------------------

/** Forward-scan cap — beyond this we declare the expression never fires. */
export const MAX_SCAN_DAYS = 366

const MS_PER_MINUTE = 60_000

export type CronPreview =
  /** Expression failed the v1 parse — the server would 400 it too. */
  | { status: 'invalid' }
  /** Parsed fine but never fires within MAX_SCAN_DAYS (e.g. `0 0 30 2 *`). */
  | { status: 'none' }
  | { status: 'ok'; times: Date[] }

/**
 * Computes the next `count` UTC fire times strictly after `from`, scanning
 * minute-by-minute (with a cheap minute/hour fast path) and giving up after
 * MAX_SCAN_DAYS. Mirrors what the dispatcher Lambda will actually do: tick
 * every minute and fire on matching UTC minutes.
 */
export function previewNextFires(
  expression: string,
  from: Date = new Date(),
  count = 3,
): CronPreview {
  const schedule = parseCronExpression(expression)
  if (!schedule) return { status: 'invalid' }

  const times: Date[] = []
  // Start at the next whole minute strictly after `from`.
  let ts = Math.floor(from.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE
  const end = from.getTime() + MAX_SCAN_DAYS * 24 * 60 * MS_PER_MINUTE

  while (ts <= end && times.length < count) {
    // Fast path: UTC minute/hour fall out of timestamp arithmetic (UTC has no
    // DST), so skip the Date allocation unless both could match.
    const minute = Math.floor(ts / MS_PER_MINUTE) % 60
    if (schedule.minutes.has(minute)) {
      const hour = Math.floor(ts / (60 * MS_PER_MINUTE)) % 24
      if (schedule.hours.has(hour)) {
        const candidate = new Date(ts)
        if (cronMatchesMinute(schedule, candidate)) times.push(candidate)
      }
    }
    ts += MS_PER_MINUTE
  }

  return times.length === 0 ? { status: 'none' } : { status: 'ok', times }
}

/** Renders a fire time as `YYYY-MM-DD HH:MM UTC` for the preview list. */
export function formatFireTimeUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
