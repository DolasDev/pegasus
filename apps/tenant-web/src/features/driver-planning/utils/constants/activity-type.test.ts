import { describe, it, expect } from 'vitest'
import { ActivityType } from './activity-type'

describe('ActivityType', () => {
  it('maps each activity to its expected code', () => {
    expect(ActivityType.PACKING).toBe('PACK')
    expect(ActivityType.PICKUP).toBe('LOAD')
    expect(ActivityType.DELIVERY).toBe('RDEL')
    expect(ActivityType.AGENTPICKUP).toBe('R19I')
    expect(ActivityType.DOCKPICKUP).toBe('WHSE')
    expect(ActivityType.EXTRAPICKUP).toBe('XPU')
    expect(ActivityType.EXTRADELIVERY).toBe('XDEL')
    expect(ActivityType.UNPACK).toBe('UNPK')
    expect(ActivityType.SITIN).toBe('SITIN')
    expect(ActivityType.SITOUT).toBe('SITOUT')
  })

  it('has unique codes', () => {
    const values = Object.values(ActivityType)
    expect(new Set(values).size).toBe(values.length)
  })
})
