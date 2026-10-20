import { describe, it, expect } from 'vitest'
import { dayLabel, displayShipper, formatShortDate, initials, routeLine } from './format'

const NOW = new Date(2026, 9, 20, 15, 0)

describe('dayLabel', () => {
  it('names today and yesterday, and dates otherwise', () => {
    expect(dayLabel(new Date(2026, 9, 20, 8).toISOString(), NOW)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 19, 23).toISOString(), NOW)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 1, 12).toISOString(), NOW)).not.toMatch(/Today|Yesterday/)
  })
})

describe('initials', () => {
  it('takes up to two initials from a name or the local part of an email', () => {
    expect(initials('Ann Lee')).toBe('AL')
    expect(initials('LEE, ANN')).toBe('LA')
    expect(initials('ops@chat.test')).toBe('O')
    expect(initials('')).toBe('?')
  })
})

describe('routeLine', () => {
  const base = {
    orderNum: 1,
    shipperName: null,
    packDate: null,
    loadDate: null,
    deliveryDate: null,
  }
  it('joins origin and destination, or shows whichever is known', () => {
    expect(routeLine({ ...base, origin: 'Austin, TX', destination: 'CO' })).toBe('Austin, TX → CO')
    expect(routeLine({ ...base, origin: null, destination: 'CO' })).toBe('CO')
    expect(routeLine(undefined)).toBeNull()
  })
})

describe('formatShortDate', () => {
  it('reads a calendar date without shifting it by time zone', () => {
    expect(formatShortDate('2026-10-21')).toBe(
      new Date(2026, 9, 21).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    )
    expect(formatShortDate(null)).toBeNull()
  })
})

describe('displayShipper', () => {
  it('title-cases an all-caps legacy name and leaves mixed case alone', () => {
    expect(displayShipper('SMITH, JOHN')).toBe('Smith, John')
    expect(displayShipper("O'NEIL-PARK")).toBe("O'Neil-Park")
    expect(displayShipper('McDonald')).toBe('McDonald')
    expect(displayShipper(null)).toBeNull()
  })
})
