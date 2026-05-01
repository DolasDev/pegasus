import { describe, it, expect } from 'vitest'
import { TRIPSTATUS_LIST } from './tripstatus-list'

describe('TRIPSTATUS_LIST', () => {
  it('exposes the expected trip status options in order', () => {
    expect(TRIPSTATUS_LIST).toEqual([
      { label: 'Unplanned', value: '0' },
      { label: 'Pending', value: '1' },
      { label: 'Offered', value: '2' },
      { label: 'Accepted', value: '3' },
      { label: 'In-Progress', value: '4' },
      { label: 'Completed', value: '5' },
    ])
  })

  it('has unique values', () => {
    const values = TRIPSTATUS_LIST.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
