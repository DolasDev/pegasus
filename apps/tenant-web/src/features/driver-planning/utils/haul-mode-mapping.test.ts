import { describe, it, expect } from 'vitest'
import {
  haulModeMapping,
  sHaulMapping,
  haulModeOptions,
  sHaulOptions,
} from './haul-mode-mapping'

describe('haulModeMapping', () => {
  it('maps single-letter codes to descriptive labels', () => {
    expect(haulModeMapping).toEqual({
      Y: 'self',
      N: 'avl',
      O: 'other',
      U: 'undecided',
      P: 'pending',
    })
  })
})

describe('sHaulMapping', () => {
  it('maps Y/N to yes/no', () => {
    expect(sHaulMapping).toEqual({ Y: 'yes', N: 'no' })
  })
})

describe('haulModeOptions', () => {
  it('emits one single-key object per haul mode entry', () => {
    expect(haulModeOptions).toEqual([
      { Y: 'self' },
      { N: 'avl' },
      { O: 'other' },
      { U: 'undecided' },
      { P: 'pending' },
    ])
  })
})

describe('sHaulOptions', () => {
  it('emits one single-key object per sHaul entry', () => {
    expect(sHaulOptions).toEqual([{ Y: 'yes' }, { N: 'no' }])
  })
})
