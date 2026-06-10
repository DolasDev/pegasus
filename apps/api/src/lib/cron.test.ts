// ---------------------------------------------------------------------------
// Table-driven tests for the dependency-free cron matcher (Phase 3 Unit 4).
//
// Two surfaces:
//   - parseCronExpression: every supported operator parses; everything outside
//     the documented v1 dialect (names, ?, 7-as-Sunday, 6 fields, inverted
//     ranges, empty/zero steps, out-of-range values, garbage) returns null.
//   - cronMatchesMinute: UTC evaluation, range boundaries, steps, and the
//     standard dom/dow rule — OR when both are restricted, AND otherwise.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { parseCronExpression, cronMatchesMinute } from './cron'

// ── parseCronExpression: accepted dialect ─────────────────────────────────

describe('parseCronExpression — valid expressions', () => {
  const valid: Array<{ expr: string; why: string }> = [
    { expr: '* * * * *', why: 'all wildcards' },
    { expr: '0 9 * * 1', why: 'plain numbers' },
    { expr: '59 23 31 12 6', why: 'upper range boundaries' },
    { expr: '0 0 1 1 0', why: 'lower range boundaries' },
    { expr: '*/15 * * * *', why: 'step on wildcard' },
    { expr: '0-30/10 * * * *', why: 'step on range' },
    { expr: '1,15,31 * * * *', why: 'comma list' },
    { expr: '0,30 9-17 * * 1-5', why: 'list + ranges' },
    { expr: '5-5 * * * *', why: 'degenerate single-value range' },
    { expr: '0-59/1 0-23 1-31 1-12 0-6', why: 'full-range fields with step 1' },
    { expr: '  0 9 * * 1  ', why: 'leading/trailing whitespace tolerated' },
  ]

  it.each(valid)('parses $expr ($why)', ({ expr }) => {
    expect(parseCronExpression(expr)).not.toBeNull()
  })

  it('expands a step on a wildcard from the field minimum', () => {
    const schedule = parseCronExpression('*/15 * * * *')!
    expect([...schedule.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45])
  })

  it('expands a step on a range from the range start', () => {
    const schedule = parseCronExpression('3-14/5 * * * *')!
    expect([...schedule.minutes].sort((a, b) => a - b)).toEqual([3, 8, 13])
  })

  it('expands comma lists including ranges', () => {
    const schedule = parseCronExpression('1,10-12,30 * * * *')!
    expect([...schedule.minutes].sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 30])
  })

  it('marks dom/dow restricted only when the field text is not exactly *', () => {
    const both = parseCronExpression('0 0 13 * 5')!
    expect(both.domRestricted).toBe(true)
    expect(both.dowRestricted).toBe(true)

    const neither = parseCronExpression('0 0 * * *')!
    expect(neither.domRestricted).toBe(false)
    expect(neither.dowRestricted).toBe(false)

    // A stepped wildcard is NOT a bare `*` — it counts as restricted.
    const steppedDow = parseCronExpression('0 0 * * */2')!
    expect(steppedDow.dowRestricted).toBe(true)
  })
})

// ── parseCronExpression: rejected expressions ─────────────────────────────

describe('parseCronExpression — invalid expressions return null', () => {
  const invalid: Array<{ expr: string; why: string }> = [
    { expr: '', why: 'empty string' },
    { expr: '   ', why: 'whitespace only' },
    { expr: '* * * *', why: '4 fields' },
    { expr: '* * * * * *', why: '6 fields (no seconds dialect)' },
    { expr: '60 * * * *', why: 'minute above 59' },
    { expr: '* 24 * * *', why: 'hour above 23' },
    { expr: '* * 0 * *', why: 'day-of-month below 1' },
    { expr: '* * 32 * *', why: 'day-of-month above 31' },
    { expr: '* * * 0 *', why: 'month below 1' },
    { expr: '* * * 13 *', why: 'month above 12' },
    { expr: '* * * * 7', why: '7-as-Sunday not supported in v1' },
    { expr: '5-1 * * * *', why: 'inverted range (no wraparound in v1)' },
    { expr: '0-60 * * * *', why: 'range end out of bounds' },
    { expr: '*/ * * * *', why: 'empty step' },
    { expr: '*/0 * * * *', why: 'zero step' },
    { expr: '*/x * * * *', why: 'non-numeric step' },
    { expr: '5/15 * * * *', why: 'step on a bare number (only * and ranges)' },
    { expr: '1,,3 * * * *', why: 'empty list entry' },
    { expr: '1,2, * * * *', why: 'trailing comma' },
    { expr: '1-2-3 * * * *', why: 'double-dash range' },
    { expr: '1- * * * *', why: 'open-ended range' },
    { expr: '-5 * * * *', why: 'negative / open-start range' },
    { expr: '? * * * *', why: '`?` not supported in v1' },
    { expr: '* * * JAN *', why: 'month names not supported in v1' },
    { expr: '* * * * MON', why: 'day names not supported in v1' },
    { expr: '@hourly', why: 'macros not supported' },
    { expr: 'garbage', why: 'garbage' },
    { expr: '1.5 * * * *', why: 'non-integer value' },
    { expr: '*/2/3 * * * *', why: 'multiple steps' },
  ]

  it.each(invalid)('rejects "$expr" ($why)', ({ expr }) => {
    expect(parseCronExpression(expr)).toBeNull()
  })
})

// ── cronMatchesMinute ─────────────────────────────────────────────────────

/** Parse-or-throw helper so a typo in a test expression fails loudly. */
function schedule(expr: string) {
  const parsed = parseCronExpression(expr)
  if (!parsed) throw new Error(`test expression failed to parse: ${expr}`)
  return parsed
}

describe('cronMatchesMinute', () => {
  // 2026-06-10 is a Wednesday; 06-12 Friday, 06-13 Saturday, 06-14 Sunday.
  const cases: Array<{ expr: string; at: string; matches: boolean; why: string }> = [
    { expr: '* * * * *', at: '2026-06-10T16:04:00Z', matches: true, why: 'wildcard always' },
    { expr: '4 16 * * *', at: '2026-06-10T16:04:00Z', matches: true, why: 'exact minute+hour' },
    { expr: '5 16 * * *', at: '2026-06-10T16:04:00Z', matches: false, why: 'minute mismatch' },
    { expr: '4 17 * * *', at: '2026-06-10T16:04:00Z', matches: false, why: 'hour mismatch' },
    { expr: '* * * 7 *', at: '2026-06-10T16:04:00Z', matches: false, why: 'month mismatch' },
    { expr: '* * * 6 *', at: '2026-06-10T16:04:00Z', matches: true, why: 'month match (1-based)' },
    // Seconds/millis within the minute are irrelevant.
    { expr: '4 16 * * *', at: '2026-06-10T16:04:59.999Z', matches: true, why: 'second-agnostic' },
    // Steps.
    { expr: '*/15 * * * *', at: '2026-06-10T16:30:00Z', matches: true, why: 'step hit' },
    { expr: '*/15 * * * *', at: '2026-06-10T16:31:00Z', matches: false, why: 'step miss' },
    { expr: '0 9-17 * * *', at: '2026-06-10T09:00:00Z', matches: true, why: 'range lower bound' },
    { expr: '0 9-17 * * *', at: '2026-06-10T17:00:00Z', matches: true, why: 'range upper bound' },
    { expr: '0 9-17 * * *', at: '2026-06-10T18:00:00Z', matches: false, why: 'past range end' },
    // Boundaries of each field's domain.
    { expr: '0 0 1 1 *', at: '2026-01-01T00:00:00Z', matches: true, why: 'all lower bounds' },
    { expr: '59 23 31 12 *', at: '2026-12-31T23:59:00Z', matches: true, why: 'all upper bounds' },
    // dow 0 = Sunday.
    { expr: '0 0 * * 0', at: '2026-06-14T00:00:00Z', matches: true, why: 'Sunday as 0' },
    { expr: '0 0 * * 0', at: '2026-06-13T00:00:00Z', matches: false, why: 'Saturday is not 0' },
    // dom restricted, dow `*` → dom alone decides.
    { expr: '0 0 13 * *', at: '2026-06-13T00:00:00Z', matches: true, why: 'dom-only match' },
    { expr: '0 0 13 * *', at: '2026-06-12T00:00:00Z', matches: false, why: 'dom-only miss' },
    // dow restricted, dom `*` → dow alone decides.
    { expr: '0 0 * * 5', at: '2026-06-12T00:00:00Z', matches: true, why: 'dow-only match (Fri)' },
    { expr: '0 0 * * 5', at: '2026-06-11T00:00:00Z', matches: false, why: 'dow-only miss (Thu)' },
    // BOTH restricted → OR rule (Vixie cron): 13th OR Friday.
    {
      expr: '0 0 13 * 5',
      at: '2026-06-13T00:00:00Z',
      matches: true,
      why: 'OR: dom hits (Sat 13th)',
    },
    {
      expr: '0 0 13 * 5',
      at: '2026-06-12T00:00:00Z',
      matches: true,
      why: 'OR: dow hits (Fri 12th)',
    },
    {
      expr: '0 0 13 * 5',
      at: '2026-02-13T00:00:00Z',
      matches: true,
      why: 'OR: both hit (Fri 13th)',
    },
    { expr: '0 0 13 * 5', at: '2026-06-11T00:00:00Z', matches: false, why: 'OR: neither hits' },
    // Stepped dow counts as restricted → OR rule engages.
    {
      expr: '0 0 13 * */7',
      at: '2026-06-14T00:00:00Z',
      matches: true,
      why: 'OR: */7 dow = {0} hits Sunday',
    },
    // Evaluation is UTC: 2026-06-10T23:30Z is still the 10th in UTC even
    // though it is already the 11th east of UTC+1.
    { expr: '30 23 10 * *', at: '2026-06-10T23:30:00Z', matches: true, why: 'UTC date fields' },
    { expr: '30 23 11 * *', at: '2026-06-10T23:30:00Z', matches: false, why: 'UTC, not local-day' },
  ]

  it.each(cases)('$expr @ $at → $matches ($why)', ({ expr, at, matches }) => {
    expect(cronMatchesMinute(schedule(expr), new Date(at))).toBe(matches)
  })
})
