import { describe, it, expect } from 'vitest'
import { ASSIGNED_LIST } from './unassigned-list'

describe('ASSIGNED_LIST', () => {
  it('exposes Yes/No options with text values', () => {
    expect(ASSIGNED_LIST).toEqual([
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ])
  })
})
