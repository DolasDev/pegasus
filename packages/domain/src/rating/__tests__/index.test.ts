import { describe, it, expect } from 'vitest'
import { toTariffCode, toTariffVersionId } from '../index'

describe('Rating ID/code factories', () => {
  it('toTariffCode preserves raw value', () => {
    expect(toTariffCode('400NG')).toBe('400NG')
  })

  it('toTariffVersionId preserves raw value', () => {
    expect(toTariffVersionId('tv-1')).toBe('tv-1')
  })
})
