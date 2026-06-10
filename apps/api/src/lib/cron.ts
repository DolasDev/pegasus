// ---------------------------------------------------------------------------
// Dependency-free 5-field cron matcher (Phase 3 Unit 4).
//
// The trigger dispatcher Lambda ticks every minute and asks one question per
// SCHEDULE trigger: "does this cron expression match the current UTC minute?"
// That is the ONLY job of this module — no next-fire computation, no catch-up,
// no timezone support. Evaluation is always UTC.
//
// Supported dialect (v1 — deliberately narrow; everything else parses to null):
//
//   fields:    minute hour day-of-month month day-of-week  (exactly 5)
//   ranges:    minute 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-6 (0=Sunday)
//   operators: `*`, plain numbers, comma lists (`1,15,30`), ranges (`a-b`,
//              inclusive, a <= b — no wraparound), steps (`*/n`, `a-b/n`)
//
// NOT supported in v1 (all return null from the parser — document, don't guess):
//   - month/day NAMES (`JAN`, `MON`), `?`, `7` as Sunday, `L` / `W` / `#`,
//     `@hourly`-style macros, seconds/years fields
//   - steps on a bare number (`5/15`) — only `*` and ranges take steps
//   - inverted ranges (`5-1`) — no midnight-wraparound semantics
//
// Day-of-month / day-of-week combination — THE standard-cron subtlety:
// when BOTH dom and dow are restricted (i.e. neither field is exactly `*`),
// the date matches if EITHER field matches (Vixie-cron OR rule: `0 0 13 * 5`
// fires on the 13th AND on every Friday). When at most one is restricted,
// both fields must match (the unrestricted `*` matches every day anyway).
// `*/2` (or any non-`*` text) counts as RESTRICTED for this rule.
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
 * UTC (seconds/milliseconds are ignored).
 *
 * Standard cron dom/dow semantics (the part everyone gets wrong): when BOTH
 * day-of-month and day-of-week are restricted (non-`*`), the day matches if
 * EITHER matches; otherwise both must match — which degenerates to the single
 * restricted field, since an unrestricted `*` set contains every day.
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
