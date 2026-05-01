import { describe, it, expect } from 'vitest'
import { SHAUL_LIST } from './shaul-list'

describe('SHAUL_LIST', () => {
  it('exposes Yes/No options', () => {
    expect(SHAUL_LIST).toEqual([
      { label: 'Yes', value: 'Y' },
      { label: 'No', value: 'N' },
    ])
  })
})
