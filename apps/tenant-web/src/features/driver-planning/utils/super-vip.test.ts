import { describe, it, expect } from 'vitest'

import { isSuperVip } from './super-vip'

describe('isSuperVip', () => {
  it('reads idc_break — the column v_longhaul_shipments_v2 actually projects', () => {
    expect(isSuperVip({ idc_break: 'Y' })).toBe(true)
    expect(isSuperVip({ idc_break: 'N' })).toBe(false)
  })

  it('does not resurrect the legacy `supervip` alias', () => {
    // #571 accepted a literal `supervip` defensively. Nothing produces one —
    // the view has no such column — and keeping it forced the parameter to stay
    // `any`. A row carrying only the alias is (correctly) not a super-VIP.
    // @ts-expect-error - `supervip` is not a column on the view
    expect(isSuperVip({ supervip: 'Y' })).toBe(false)
  })

  it('is false for a row carrying neither field, and for no row at all', () => {
    expect(isSuperVip({ vip: 'Y' })).toBe(false)
    expect(isSuperVip({})).toBe(false)
    expect(isSuperVip(null)).toBe(false)
    expect(isSuperVip(undefined)).toBe(false)
  })
})
