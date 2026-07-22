import { describe, it, expect } from 'vitest'
import { activeDriverFilter, availabilityDriverFilter } from './driver-filter'

describe('activeDriverFilter', () => {
  it('filters to active drivers only', () => {
    expect(activeDriverFilter()).toBe("ACTIVE = 'Y'")
  })

  it('does NOT exclude the 99994-99999 range — every active driver is selectable', () => {
    expect(activeDriverFilter()).not.toContain('NOT IN')
  })

  it('threads a table prefix', () => {
    expect(activeDriverFilter('d')).toBe("d.ACTIVE = 'Y'")
  })
})

describe('availabilityDriverFilter', () => {
  it('filters to active drivers and excludes the placeholder ID range', () => {
    expect(availabilityDriverFilter()).toBe(
      "ACTIVE = 'Y' AND DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)",
    )
  })

  it('threads a table prefix onto every column', () => {
    expect(availabilityDriverFilter('d')).toBe(
      "d.ACTIVE = 'Y' AND d.DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)",
    )
  })
})
