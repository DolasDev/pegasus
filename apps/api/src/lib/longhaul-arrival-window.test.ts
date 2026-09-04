// ---------------------------------------------------------------------------
// Unit tests for arrival-window validation and UTC derivation.
//
// The DST cases are the point of the whole module: an 8:00 window on the day
// the clocks change must still be 8:00 to the customer, and the instant the
// automation fires on has to move with it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  parseHhMm,
  validateArrivalWindow,
  zoneOffsetMinutes,
  localToUtc,
  zoneAbbreviation,
  arrivalWindowDate,
  deriveArrivalWindow,
  enrichActivityArrivalWindow,
  isKnownTimeZone,
} from './longhaul-arrival-window'

describe('parseHhMm', () => {
  it('accepts a zero-padded 24-hour time', () => {
    expect(parseHhMm('08:00')).toBe('08:00')
    expect(parseHhMm('00:00')).toBe('00:00')
    expect(parseHhMm('23:59')).toBe('23:59')
  })

  it('trims surrounding whitespace', () => {
    expect(parseHhMm(' 10:30 ')).toBe('10:30')
  })

  it('rejects anything that is not exactly HH:mm', () => {
    for (const bad of ['8:00', '08:00:00', '24:00', '08:60', '0800', '8am', '', null, 800]) {
      expect(parseHhMm(bad)).toBeNull()
    }
  })
})

describe('validateArrivalWindow', () => {
  const ok = {
    arrival_window_start: '08:00',
    arrival_window_end: '10:00',
    arrival_window_tz: 'America/New_York',
  }

  it('passes a well-formed window', () => {
    expect(validateArrivalWindow(ok)).toBeNull()
  })

  it('leaves a patch that touches no window field alone', () => {
    expect(validateArrivalWindow({ estimated_date: '2026-09-11', is_confirmed: true })).toBeNull()
  })

  it('allows clearing the window by blanking all three fields', () => {
    expect(
      validateArrivalWindow({
        arrival_window_start: null,
        arrival_window_end: null,
        arrival_window_tz: null,
      }),
    ).toBeNull()
  })

  it('allows a zero-length window (a promised arrival AT a time)', () => {
    expect(validateArrivalWindow({ ...ok, arrival_window_end: '08:00' })).toBeNull()
  })

  it('rejects a partial patch — the three fields move together', () => {
    expect(validateArrivalWindow({ arrival_window_start: '08:00' })).toMatch(/together/)
  })

  it('rejects a window with no time zone, which the automation cannot use', () => {
    const error = validateArrivalWindow({ ...ok, arrival_window_tz: null })
    expect(error).toMatch(/time zone/)
  })

  it('rejects a window missing one end', () => {
    expect(validateArrivalWindow({ ...ok, arrival_window_end: null })).toMatch(/start and an end/)
  })

  it('rejects an end earlier than its start', () => {
    expect(
      validateArrivalWindow({ ...ok, arrival_window_start: '14:00', arrival_window_end: '10:00' }),
    ).toMatch(/must not be earlier/)
  })

  it('rejects a malformed time and says which field', () => {
    expect(validateArrivalWindow({ ...ok, arrival_window_start: '8am' })).toMatch(
      /arrival_window_start must be HH:mm/,
    )
    expect(validateArrivalWindow({ ...ok, arrival_window_end: '25:00' })).toMatch(
      /arrival_window_end must be HH:mm/,
    )
  })

  it('rejects a zone this runtime does not know', () => {
    expect(validateArrivalWindow({ ...ok, arrival_window_tz: 'America/Nowhere' })).toMatch(
      /Unknown time zone/,
    )
  })

  it('does NOT relate the window to any date column', () => {
    // The last guard on this table that compared two columns broke 8 prod rows
    // (#619 → #622). A window on an activity whose actual date precedes its
    // planned date is legitimate and must pass.
    expect(
      validateArrivalWindow({
        ...ok,
        planned_start: '2026-09-11',
        planned_end: '2026-09-01',
        actual_date: '2026-08-30',
      }),
    ).toBeNull()
  })
})

describe('isKnownTimeZone', () => {
  it('accepts real IANA ids and rejects junk', () => {
    expect(isKnownTimeZone('America/New_York')).toBe(true)
    expect(isKnownTimeZone('Not/AZone')).toBe(false)
    expect(isKnownTimeZone('')).toBe(false)
    expect(isKnownTimeZone(null)).toBe(false)
  })
})

describe('zoneOffsetMinutes', () => {
  it('reads standard and daylight offsets for the same zone', () => {
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300)
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240)
  })

  it('keeps Arizona on standard time all year', () => {
    expect(zoneOffsetMinutes('America/Phoenix', new Date('2026-01-15T12:00:00Z'))).toBe(-420)
    expect(zoneOffsetMinutes('America/Phoenix', new Date('2026-07-15T12:00:00Z'))).toBe(-420)
  })

  it('handles a half-hour zone (Newfoundland)', () => {
    expect(zoneOffsetMinutes('America/St_Johns', new Date('2026-01-15T12:00:00Z'))).toBe(-210)
  })

  it('handles UTC itself', () => {
    expect(zoneOffsetMinutes('UTC', new Date('2026-01-15T12:00:00Z'))).toBe(0)
  })
})

describe('localToUtc', () => {
  it('converts an 8am Eastern window in winter', () => {
    expect(localToUtc('2026-01-15', '08:00', 'America/New_York')?.toISOString()).toBe(
      '2026-01-15T13:00:00.000Z',
    )
  })

  it('converts an 8am Eastern window in summer — one hour earlier in UTC', () => {
    expect(localToUtc('2026-07-15', '08:00', 'America/New_York')?.toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    )
  })

  it('is correct ON the spring-forward day', () => {
    // US DST begins 2026-03-08. An 8:00 window that morning is already EDT.
    expect(localToUtc('2026-03-08', '08:00', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T12:00:00.000Z',
    )
  })

  it('is correct ON the fall-back day', () => {
    // DST ends 2026-11-01. An 8:00 window that morning is EST again.
    expect(localToUtc('2026-11-01', '08:00', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T13:00:00.000Z',
    )
  })

  it('resolves a time inside the fall-back repeated hour to the first occurrence', () => {
    // 01:30 happens twice on 2026-11-01 in Eastern. Picking the earlier (EDT)
    // one is the documented behaviour; a window at that hour is vanishingly
    // rare, but it must be deterministic rather than throw.
    expect(localToUtc('2026-11-01', '01:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    )
  })

  it('produces a deterministic instant for a time skipped by spring-forward', () => {
    // 02:30 does not exist on 2026-03-08 in Eastern. It must resolve, not throw.
    const resolved = localToUtc('2026-03-08', '02:30', 'America/New_York')
    expect(resolved).toBeInstanceOf(Date)
    expect(Number.isNaN(resolved?.getTime())).toBe(false)
  })

  it('honours a zone that does not observe DST', () => {
    expect(localToUtc('2026-07-15', '08:00', 'America/Phoenix')?.toISOString()).toBe(
      '2026-07-15T15:00:00.000Z',
    )
  })

  it('honours a half-hour zone', () => {
    expect(localToUtc('2026-01-15', '08:00', 'America/St_Johns')?.toISOString()).toBe(
      '2026-01-15T11:30:00.000Z',
    )
  })

  it('accepts a stored naive-midnight datetime as the date', () => {
    expect(localToUtc('2026-01-15 00:00:00', '08:00', 'America/New_York')?.toISOString()).toBe(
      '2026-01-15T13:00:00.000Z',
    )
  })

  it('returns null on a bad date, time or zone rather than throwing', () => {
    expect(localToUtc('nope', '08:00', 'America/New_York')).toBeNull()
    expect(localToUtc('2026-01-15', '8am', 'America/New_York')).toBeNull()
    expect(localToUtc('2026-01-15', '08:00', 'Mars/Olympus')).toBeNull()
  })
})

describe('zoneAbbreviation', () => {
  it('distinguishes EST from EDT by date', () => {
    expect(zoneAbbreviation('America/New_York', new Date('2026-01-15T13:00:00Z'))).toBe('EST')
    expect(zoneAbbreviation('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe('EDT')
  })

  it('returns null for an unknown zone', () => {
    expect(zoneAbbreviation('Mars/Olympus', new Date())).toBeNull()
  })
})

describe('arrivalWindowDate', () => {
  it('prefers the ETA — that is the date customer service quotes', () => {
    expect(
      arrivalWindowDate({
        estimated_date: '2026-09-11 00:00:00',
        planned_start: '2026-09-08 00:00:00',
      }),
    ).toBe('2026-09-11')
  })

  it('falls back to planned_start when no ETA is set', () => {
    expect(arrivalWindowDate({ estimated_date: null, planned_start: '2026-09-08 00:00:00' })).toBe(
      '2026-09-08',
    )
  })

  it('reads a Date as its UTC day, not the host-local one', () => {
    // Stored values are naive UTC midnight; reading the local day would report
    // the previous date anywhere west of UTC (the parseDateOnly lesson).
    expect(arrivalWindowDate({ estimated_date: new Date('2026-09-11T00:00:00Z') })).toBe(
      '2026-09-11',
    )
  })

  it('returns null when the activity carries no usable date', () => {
    expect(arrivalWindowDate({ estimated_date: null, planned_start: null })).toBeNull()
    expect(arrivalWindowDate({})).toBeNull()
  })
})

describe('deriveArrivalWindow', () => {
  const activity = {
    state: 'NJ',
    zip: '07030',
    estimated_date: '2026-09-11 00:00:00',
    arrival_window_start: '08:00',
    arrival_window_end: '10:00',
    arrival_window_tz: 'America/New_York',
  }

  it('derives the UTC instants the SMS automation schedules against', () => {
    expect(deriveArrivalWindow(activity)).toMatchObject({
      arrival_window_date: '2026-09-11',
      arrival_window_tz_label: 'EDT',
      arrival_window_start_utc: '2026-09-11T12:00:00.000Z',
      arrival_window_end_utc: '2026-09-11T14:00:00.000Z',
    })
  })

  it('always reports what the resolver would suggest, for the popover prefill', () => {
    expect(deriveArrivalWindow(activity)).toMatchObject({
      arrival_window_tz_suggested: 'America/New_York',
      arrival_window_tz_confidence: 'confident',
    })
  })

  it('flags a split state as needing confirmation even when a window is stored', () => {
    expect(deriveArrivalWindow({ ...activity, state: 'TN', zip: '37201' })).toMatchObject({
      arrival_window_tz_confidence: 'likely',
    })
  })

  it('no-ops cleanly on a tenant whose columns are not provisioned yet', () => {
    // SELECT a.* on an un-ALTERed table simply omits the keys.
    const bare = { state: 'NJ', zip: '07030', estimated_date: '2026-09-11 00:00:00' }
    expect(deriveArrivalWindow(bare)).toMatchObject({
      arrival_window_date: '2026-09-11',
      arrival_window_start_utc: null,
      arrival_window_end_utc: null,
      arrival_window_tz_label: null,
    })
  })

  it('derives nothing when the window has no date to anchor to', () => {
    const undated = { ...activity, estimated_date: null, planned_start: null }
    expect(deriveArrivalWindow(undated)).toMatchObject({
      arrival_window_date: null,
      arrival_window_start_utc: null,
    })
  })

  it('ignores a stored window whose zone is no longer recognized', () => {
    expect(
      deriveArrivalWindow({ ...activity, arrival_window_tz: 'America/Nowhere' }),
    ).toMatchObject({ arrival_window_start_utc: null })
  })

  it('moves the window when the ETA date moves — the window has no date of its own', () => {
    const moved = deriveArrivalWindow({ ...activity, estimated_date: '2026-12-11 00:00:00' })
    expect(moved.arrival_window_date).toBe('2026-12-11')
    // December is EST, so the same 8:00 local is an hour later in UTC.
    expect(moved.arrival_window_start_utc).toBe('2026-12-11T13:00:00.000Z')
    expect(moved.arrival_window_tz_label).toBe('EST')
  })
})

describe('enrichActivityArrivalWindow', () => {
  it('merges the derived fields without disturbing the activity', () => {
    const enriched = enrichActivityArrivalWindow({
      id: 53517,
      order_num: 489808,
      state: 'NJ',
      zip: '07030',
      estimated_date: '2026-09-11 00:00:00',
      arrival_window_start: '08:00',
      arrival_window_end: '10:00',
      arrival_window_tz: 'America/New_York',
    })
    expect(enriched.id).toBe(53517)
    expect(enriched.order_num).toBe(489808)
    expect(enriched.arrival_window_start).toBe('08:00')
    expect(enriched.arrival_window_start_utc).toBe('2026-09-11T12:00:00.000Z')
  })
})
