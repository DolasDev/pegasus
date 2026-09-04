import { describe, it, expect } from 'vitest'
import { formatHhMm, formatWindowDate, formatArrivalWindow } from './arrival-window'

describe('formatHhMm', () => {
  it('renders a 24-hour time as 12-hour with a meridiem', () => {
    expect(formatHhMm('08:00')).toBe('8:00 AM')
    expect(formatHhMm('13:30')).toBe('1:30 PM')
  })

  it('renders both noon and midnight as 12, not 0', () => {
    expect(formatHhMm('00:15')).toBe('12:15 AM')
    expect(formatHhMm('12:00')).toBe('12:00 PM')
  })

  it('passes through anything that is not HH:mm rather than mangling it', () => {
    expect(formatHhMm('whenever')).toBe('whenever')
    expect(formatHhMm(null)).toBe('')
    expect(formatHhMm(undefined)).toBe('')
  })
})

describe('formatWindowDate', () => {
  it('renders a calendar day as weekday + MM/DD', () => {
    // 2026-09-11 is a Friday.
    expect(formatWindowDate('2026-09-11')).toBe('Fri 09/11')
  })

  it('reads the day from the string, never through a UTC Date', () => {
    // `new Date('2026-01-01')` is UTC midnight, which renders as 12/31 anywhere
    // west of UTC — the bug parseDateOnly exists to prevent. Parsing the parts
    // by hand keeps this stable in every host timezone.
    expect(formatWindowDate('2026-01-01')).toBe('Thu 01/01')
  })

  it('accepts a stored naive-midnight datetime', () => {
    expect(formatWindowDate('2026-09-11 00:00:00')).toBe('Fri 09/11')
  })

  it('returns empty for a missing or unparseable date', () => {
    expect(formatWindowDate(null)).toBe('')
    expect(formatWindowDate('nope')).toBe('')
  })
})

describe('formatArrivalWindow', () => {
  it('renders the full line the popover shows', () => {
    expect(
      formatArrivalWindow({
        start: '08:00',
        end: '10:00',
        windowDate: '2026-09-11',
        zoneLabel: 'EDT',
      }),
    ).toBe('Fri 09/11 · 8:00 AM – 10:00 AM EDT')
  })

  it('drops the date when the activity has none yet', () => {
    expect(formatArrivalWindow({ start: '08:00', end: '10:00', zoneLabel: 'EDT' })).toBe(
      '8:00 AM – 10:00 AM EDT',
    )
  })

  it('drops the zone label when the server has not derived one', () => {
    expect(formatArrivalWindow({ start: '08:00', end: '10:00' })).toBe('8:00 AM – 10:00 AM')
  })

  it('is empty when there is no window — never an implied 8–10', () => {
    expect(formatArrivalWindow({})).toBe('')
    expect(formatArrivalWindow({ windowDate: '2026-09-11', zoneLabel: 'EDT' })).toBe('')
  })
})
