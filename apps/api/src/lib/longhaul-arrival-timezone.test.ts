// ---------------------------------------------------------------------------
// Unit tests for arrival-window time-zone resolution.
//
// The behaviour under test is as much about what the resolver REFUSES to answer
// as what it answers: a silently-wrong zone means a customer gets texted an
// hour early, so a split state must never come back 'confident'.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { ARRIVAL_WINDOW_TIME_ZONE_IDS } from '@pegasus/longhaul-contracts'
import { resolveTimeZone, zip3Of, SELECTABLE_TIME_ZONES } from './longhaul-arrival-timezone'

describe('zip3Of', () => {
  it('takes the first three digits of a 5-digit ZIP', () => {
    expect(zip3Of('07030')).toBe('070')
  })

  it('handles ZIP+4 and stray whitespace/punctuation', () => {
    expect(zip3Of(' 79936-1234 ')).toBe('799')
  })

  it('accepts a numeric ZIP (the legacy columns are not consistently typed)', () => {
    expect(zip3Of(37402)).toBe('374')
  })

  it('returns null for a Canadian postal code rather than slicing its digits', () => {
    // 'M5V 3A8' → digits '538' would be a Kentucky prefix. Catching the
    // letter-digit-letter shape is what stops that.
    expect(zip3Of('M5V 3A8')).toBeNull()
    expect(zip3Of('t2p1j9')).toBeNull()
  })

  it('returns null for blank, short or non-string input', () => {
    expect(zip3Of('')).toBeNull()
    expect(zip3Of('071')).toBeNull()
    expect(zip3Of(null)).toBeNull()
    expect(zip3Of(undefined)).toBeNull()
  })
})

describe('resolveTimeZone — single-zone states', () => {
  it('auto-applies a state that lies entirely in one zone', () => {
    expect(resolveTimeZone({ state: 'NJ', zip: '07030' })).toMatchObject({
      timeZone: 'America/New_York',
      confidence: 'confident',
    })
  })

  it('is case- and whitespace-insensitive on the state code', () => {
    expect(resolveTimeZone({ state: ' ca ' }).timeZone).toBe('America/Los_Angeles')
  })

  it('does not need a ZIP when the state is unambiguous', () => {
    expect(resolveTimeZone({ state: 'CO' })).toMatchObject({
      timeZone: 'America/Denver',
      confidence: 'confident',
    })
  })

  it('gives Saskatchewan its own zone — it keeps CST year-round, unlike Chicago', () => {
    expect(resolveTimeZone({ state: 'SK' })).toMatchObject({
      timeZone: 'America/Regina',
      confidence: 'confident',
    })
  })

  it('resolves Canadian provinces that are single-zone', () => {
    expect(resolveTimeZone({ state: 'AB', zip: 'T2P 1J9' })).toMatchObject({
      timeZone: 'America/Edmonton',
      confidence: 'confident',
    })
  })
})

describe('resolveTimeZone — split states are never confident', () => {
  it.each([
    'AK',
    'AZ',
    'FL',
    'ID',
    'IN',
    'KS',
    'KY',
    'MI',
    'ND',
    'NE',
    'OR',
    'SD',
    'TN',
    'TX',
    'BC',
    'ON',
    'NL',
    'NU',
  ])('%s comes back "likely", never "confident"', (state) => {
    const resolved = resolveTimeZone({ state })
    expect(resolved.confidence).toBe('likely')
    expect(resolved.timeZone).not.toBeNull()
  })

  it('falls back to the majority zone when no ZIP3 hint matches', () => {
    // Dallas — Texas is majority Central.
    expect(resolveTimeZone({ state: 'TX', zip: '75201' })).toMatchObject({
      timeZone: 'America/Chicago',
      confidence: 'likely',
    })
  })

  it('uses the ZIP3 hint for El Paso, which is Mountain', () => {
    expect(resolveTimeZone({ state: 'TX', zip: '79936' })).toMatchObject({
      timeZone: 'America/Denver',
      confidence: 'likely',
    })
  })

  it('splits Florida between Jacksonville (Eastern) and Pensacola (Central)', () => {
    expect(resolveTimeZone({ state: 'FL', zip: '32202' }).timeZone).toBe('America/New_York')
    expect(resolveTimeZone({ state: 'FL', zip: '32501' }).timeZone).toBe('America/Chicago')
  })

  it('splits Tennessee between Nashville (Central) and Knoxville (Eastern)', () => {
    expect(resolveTimeZone({ state: 'TN', zip: '37201' }).timeZone).toBe('America/Chicago')
    expect(resolveTimeZone({ state: 'TN', zip: '37902' }).timeZone).toBe('America/New_York')
  })

  it('puts Malheur County, Oregon on Mountain time with Idaho', () => {
    expect(resolveTimeZone({ state: 'OR', zip: '97914' }).timeZone).toBe('America/Boise')
    expect(resolveTimeZone({ state: 'OR', zip: '97201' }).timeZone).toBe('America/Los_Angeles')
  })

  it('puts the Idaho panhandle on Pacific and the rest on Mountain', () => {
    expect(resolveTimeZone({ state: 'ID', zip: '83814' }).timeZone).toBe('America/Los_Angeles')
    expect(resolveTimeZone({ state: 'ID', zip: '83702' }).timeZone).toBe('America/Boise')
  })

  it('tracks the Navajo Nation to Denver, since it observes DST and Phoenix does not', () => {
    expect(resolveTimeZone({ state: 'AZ', zip: '86515' }).timeZone).toBe('America/Denver')
    expect(resolveTimeZone({ state: 'AZ', zip: '85004' }).timeZone).toBe('America/Phoenix')
  })
})

describe('resolveTimeZone — unresolvable', () => {
  it('returns unknown with no zone when the activity has no state', () => {
    expect(resolveTimeZone({ zip: '07030' })).toMatchObject({
      timeZone: null,
      confidence: 'unknown',
    })
  })

  it('returns unknown for an unrecognized state/province code', () => {
    const resolved = resolveTimeZone({ state: 'XX' })
    expect(resolved).toMatchObject({ timeZone: null, confidence: 'unknown' })
    expect(resolved.reason).toContain('XX')
  })

  it('always explains itself — the reason is surfaced in the popover', () => {
    for (const location of [{ state: 'NJ' }, { state: 'TX' }, { state: '' }]) {
      expect(resolveTimeZone(location).reason).not.toBe('')
    }
  })
})

describe('SELECTABLE_TIME_ZONES', () => {
  it('offers every zone the resolver can produce, so an override can always match', () => {
    for (const state of ['NJ', 'TX', 'AZ', 'SK', 'HI', 'PR', 'NL']) {
      const { timeZone } = resolveTimeZone({ state })
      if (timeZone) expect(SELECTABLE_TIME_ZONES).toContain(timeZone)
    }
  })

  it('is sorted and free of duplicates', () => {
    expect(SELECTABLE_TIME_ZONES).toEqual([...new Set(SELECTABLE_TIME_ZONES)].sort())
  })

  it('names only zones this runtime recognizes', () => {
    for (const tz of SELECTABLE_TIME_ZONES) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow()
    }
  })
})

describe('the picker and the resolver cannot drift apart', () => {
  it('offers every zone the resolver can produce in the shared contract', () => {
    // tenant-web builds its dropdown from ARRIVAL_WINDOW_TIME_ZONE_IDS. A zone
    // this resolver suggests but the picker cannot offer would be one the
    // dispatcher is shown and can never select.
    for (const tz of SELECTABLE_TIME_ZONES) {
      expect(ARRIVAL_WINDOW_TIME_ZONE_IDS).toContain(tz)
    }
  })

  it('offers no zone this runtime cannot resolve', () => {
    for (const tz of ARRIVAL_WINDOW_TIME_ZONE_IDS) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow()
    }
  })
})
