import { describe, expect, it } from 'vitest'
import { OPERATIONS_ROLES, hasOperationsRole } from '../roles'

describe('hasOperationsRole', () => {
  it('is true when any role is an Operations role', () => {
    expect(hasOperationsRole(['driver', 'long_distance_dispatch'])).toBe(true)
    for (const r of OPERATIONS_ROLES) expect(hasOperationsRole([r])).toBe(true)
  })

  it('is false for drivers, viewers and missing roles', () => {
    expect(hasOperationsRole(['driver', 'viewer'])).toBe(false)
    expect(hasOperationsRole([])).toBe(false)
    expect(hasOperationsRole(undefined)).toBe(false)
  })
})
