import { describe, it, expect } from 'vitest'
import { STATE_LIST } from './state-list'

describe('STATE_LIST', () => {
  it('contains 59 entries (50 states + DC + territories)', () => {
    expect(STATE_LIST).toHaveLength(59)
  })

  it('all entries are { label, value } with non-empty strings', () => {
    for (const entry of STATE_LIST) {
      expect(typeof entry.label).toBe('string')
      expect(entry.label.length).toBeGreaterThan(0)
      expect(typeof entry.value).toBe('string')
      expect(entry.value.length).toBeGreaterThan(0)
    }
  })

  it('all values are unique two-letter codes', () => {
    const values = STATE_LIST.map((s) => s.value)
    expect(new Set(values).size).toBe(values.length)
    for (const value of values) {
      expect(value).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('includes well-known states with the right codes', () => {
    expect(STATE_LIST).toContainEqual({ label: 'California', value: 'CA' })
    expect(STATE_LIST).toContainEqual({ label: 'New York', value: 'NY' })
    expect(STATE_LIST).toContainEqual({ label: 'Texas', value: 'TX' })
    expect(STATE_LIST).toContainEqual({ label: 'District Of Columbia', value: 'DC' })
  })
})
