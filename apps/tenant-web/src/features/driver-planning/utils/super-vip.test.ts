import { describe, it, expect } from 'vitest'

import { isSuperVip } from './super-vip'

describe('isSuperVip', () => {
  it('reads idc_break — the column v_longhaul_shipments_v2 actually projects', () => {
    expect(isSuperVip({ idc_break: 'Y' })).toBe(true)
    expect(isSuperVip({ idc_break: 'N' })).toBe(false)
  })

  it('still honors an already-aliased supervip payload', () => {
    // The legacy entity aliased idc_break -> supervip; anything handing us a
    // hydrated row (or a fixture written against the old shape) keeps working.
    expect(isSuperVip({ supervip: 'Y' })).toBe(true)
  })

  it('is false for a row carrying neither field, and for no row at all', () => {
    expect(isSuperVip({ vip: 'Y' })).toBe(false)
    expect(isSuperVip({})).toBe(false)
    expect(isSuperVip(null)).toBe(false)
    expect(isSuperVip(undefined)).toBe(false)
  })
})
