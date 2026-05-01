import { describe, it, expect } from 'vitest'
import { HAULMODE_LIST } from './haulmode-list'

describe('HAULMODE_LIST', () => {
  it('exposes the expected haul mode options', () => {
    expect(HAULMODE_LIST).toEqual([
      { label: 'Self', value: 'Y' },
      { label: 'Atlas', value: 'N' },
      { label: 'Other', value: 'O' },
      { label: 'Undecided', value: 'U' },
      { label: 'Pending', value: 'P' },
    ])
  })

  it('has unique values', () => {
    const values = HAULMODE_LIST.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
