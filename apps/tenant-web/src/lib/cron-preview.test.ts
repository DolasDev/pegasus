// ---------------------------------------------------------------------------
// Unit tests for the frontend cron next-fire preview. The parser/matcher are
// a port of apps/api/src/lib/cron.ts — the dialect-parity cases here mirror
// the server's accepted/rejected expressions so drift gets caught.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  MAX_SCAN_DAYS,
  cronMatchesMinute,
  formatFireTimeUtc,
  parseCronExpression,
  previewNextFires,
} from './cron-preview'

describe('parseCronExpression — dialect parity with apps/api/src/lib/cron.ts', () => {
  it.each([
    '* * * * *',
    '*/5 * * * *',
    '0 0 * * *',
    '1,15,30 * * * *',
    '0-29 * * * *',
    '0-58/2 9-17 * * 1-5',
    '0 0 13 * 5',
    '59 23 31 12 6',
  ])('accepts %s', (expr) => {
    expect(parseCronExpression(expr)).not.toBeNull()
  })

  it.each([
    ['61 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 0 * *', 'dom below range'],
    ['* * 32 * *', 'dom above range'],
    ['* * * 13 *', 'month out of range'],
    ['* * * * 7', '7 as Sunday unsupported'],
    ['* * * *', 'only 4 fields'],
    ['* * * * * *', '6 fields'],
    ['5/15 * * * *', 'step on a bare number'],
    ['5-1 * * * *', 'inverted range'],
    ['*/0 * * * *', 'zero step'],
    ['*/ * * * *', 'empty step'],
    ['1,,3 * * * *', 'empty list entry'],
    ['* * * JAN *', 'month names'],
    ['* * * * MON', 'day names'],
    ['@hourly', 'macros'],
    ['? * * * *', 'question mark'],
    ['', 'empty string'],
  ])('rejects %s (%s)', (expr) => {
    expect(parseCronExpression(expr)).toBeNull()
  })
})

describe('cronMatchesMinute — dom/dow OR rule', () => {
  // `0 0 13 * 5` — both dom (13) and dow (Friday) restricted → EITHER matches.
  const schedule = parseCronExpression('0 0 13 * 5')!

  it('fires on the 13th even when it is not a Friday', () => {
    // 2026-01-13 is a Tuesday.
    expect(cronMatchesMinute(schedule, new Date(Date.UTC(2026, 0, 13, 0, 0)))).toBe(true)
  })

  it('fires on a Friday even when it is not the 13th', () => {
    // 2026-01-02 is a Friday.
    expect(cronMatchesMinute(schedule, new Date(Date.UTC(2026, 0, 2, 0, 0)))).toBe(true)
  })

  it('does not fire on a non-Friday non-13th', () => {
    // 2026-01-05 is a Monday.
    expect(cronMatchesMinute(schedule, new Date(Date.UTC(2026, 0, 5, 0, 0)))).toBe(false)
  })

  it('requires BOTH when only one of dom/dow is restricted', () => {
    // `0 0 13 * *` — dow unrestricted → must be the 13th.
    const domOnly = parseCronExpression('0 0 13 * *')!
    expect(cronMatchesMinute(domOnly, new Date(Date.UTC(2026, 0, 2, 0, 0)))).toBe(false)
    expect(cronMatchesMinute(domOnly, new Date(Date.UTC(2026, 0, 13, 0, 0)))).toBe(true)
  })

  it('treats */n in dow as restricted (documented server deviation)', () => {
    // dom=13 restricted, dow=*/2 ({0,2,4,6}) also restricted → OR rule:
    // Tuesday(2) the 6th fires via dow even though dom says 13.
    const schedule2 = parseCronExpression('0 0 13 * */2')!
    // 2026-01-06 is a Tuesday (dow 2).
    expect(cronMatchesMinute(schedule2, new Date(Date.UTC(2026, 0, 6, 0, 0)))).toBe(true)
  })
})

describe('previewNextFires', () => {
  const from = new Date(Date.UTC(2026, 5, 10, 12, 0, 30)) // 2026-06-10 12:00:30Z

  it('returns invalid for unparseable expressions', () => {
    expect(previewNextFires('61 * * * *', from)).toEqual({ status: 'invalid' })
    expect(previewNextFires('nonsense', from)).toEqual({ status: 'invalid' })
  })

  it('returns the next 3 fires for */5, starting strictly after `from`', () => {
    const preview = previewNextFires('*/5 * * * *', from)
    expect(preview.status).toBe('ok')
    if (preview.status !== 'ok') return
    expect(preview.times.map((t) => t.toISOString())).toEqual([
      '2026-06-10T12:05:00.000Z',
      '2026-06-10T12:10:00.000Z',
      '2026-06-10T12:15:00.000Z',
    ])
  })

  it('does not return the minute containing `from` itself', () => {
    // from is 12:00:30 — `0 12 * * *` matches 12:00 today, but the preview
    // starts at the NEXT minute, so the first fire is tomorrow.
    const preview = previewNextFires('0 12 * * *', from)
    expect(preview.status).toBe('ok')
    if (preview.status !== 'ok') return
    expect(preview.times[0]!.toISOString()).toBe('2026-06-11T12:00:00.000Z')
  })

  it('honors the dom/dow OR rule in forward scans', () => {
    const preview = previewNextFires('0 0 13 * 5', from)
    expect(preview.status).toBe('ok')
    if (preview.status !== 'ok') return
    // From 2026-06-10: Friday 12th fires before Saturday the 13th.
    expect(preview.times.map((t) => t.toISOString())).toEqual([
      '2026-06-12T00:00:00.000Z', // Friday
      '2026-06-13T00:00:00.000Z', // the 13th (Saturday)
      '2026-06-19T00:00:00.000Z', // Friday
    ])
  })

  it('returns none for expressions that never fire (366-day cap)', () => {
    // February 30th does not exist.
    expect(previewNextFires('0 0 30 2 *', from)).toEqual({ status: 'none' })
  })

  it('returns the fires it found when fewer than `count` land inside the cap', () => {
    // Feb 29 only exists in leap years — exactly one occurrence (2028-02-29)
    // within 366 days of 2027-03-01.
    const fromNearLeap = new Date(Date.UTC(2027, 2, 1, 0, 0))
    const preview = previewNextFires('0 0 29 2 *', fromNearLeap)
    expect(preview.status).toBe('ok')
    if (preview.status !== 'ok') return
    expect(preview.times.map((t) => t.toISOString())).toEqual(['2028-02-29T00:00:00.000Z'])
  })

  it('exports a 366-day cap', () => {
    expect(MAX_SCAN_DAYS).toBe(366)
  })
})

describe('formatFireTimeUtc', () => {
  it('renders YYYY-MM-DD HH:MM UTC', () => {
    expect(formatFireTimeUtc(new Date(Date.UTC(2026, 5, 10, 12, 5)))).toBe('2026-06-10 12:05 UTC')
  })
})
