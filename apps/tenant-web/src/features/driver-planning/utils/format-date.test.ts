import { describe, it, expect } from 'vitest'
import { formatDate, formatDateShort } from './format-date'

describe('formatDate', () => {
  it('formats an ISO date string with default options as MM/DD/YY in UTC', () => {
    expect(formatDate('2024-01-05')).toBe('01/05/24')
  })

  it('formats a Date instance', () => {
    expect(formatDate(new Date('2024-12-31T00:00:00Z'))).toBe('12/31/24')
  })

  it('returns empty string for falsy date by default', () => {
    expect(formatDate(undefined)).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate(0)).toBe('')
  })

  it('returns provided defaultVal when date is falsy', () => {
    expect(formatDate(null, { defaultVal: 'N/A' })).toBe('N/A')
  })

  it('returns undefined when type is not local-date', () => {
    expect(formatDate('2024-01-05', { type: 'other' })).toBeUndefined()
  })
})

describe('formatDateShort', () => {
  it('formats with default options as MM/DD in UTC', () => {
    expect(formatDateShort('2024-01-05')).toBe('01/05')
  })

  it('returns empty string for falsy date by default', () => {
    expect(formatDateShort(undefined)).toBe('')
  })

  it('returns provided defaultVal when date is falsy', () => {
    expect(formatDateShort(null, { defaultVal: '--' })).toBe('--')
  })

  it('returns undefined when type is not local-date', () => {
    expect(formatDateShort('2024-01-05', { type: 'other' })).toBeUndefined()
  })
})
