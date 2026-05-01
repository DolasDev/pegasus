import { describe, it, expect } from 'vitest'
import { MOVETYPE_LIST } from './movetype-list'

describe('MOVETYPE_LIST', () => {
  it('exposes the expected move type options', () => {
    expect(MOVETYPE_LIST).toEqual([
      { label: 'Interstate', value: 'H' },
      { label: 'Hauler Only', value: 'HA' },
      { label: 'Auto Only', value: 'A' },
      { label: 'Military', value: 'M' },
      { label: 'Small Shipment', value: 'SS' },
    ])
  })

  it('has unique values', () => {
    const values = MOVETYPE_LIST.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
