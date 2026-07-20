// ---------------------------------------------------------------------------
// Unit tests for the shared v_longhaul_salesman active-staff predicate.
//
// Pure string builder — no Prisma, no executor, no I/O.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { longhaulSalesmanActiveFilter } from './salesman-filter'

describe('longhaulSalesmanActiveFilter', () => {
  it('returns an unqualified predicate by default', () => {
    expect(longhaulSalesmanActiveFilter()).toBe("active = 'Y'")
  })

  it('qualifies the column when a prefix is supplied', () => {
    expect(longhaulSalesmanActiveFilter('[v_longhaul_salesman]')).toBe(
      "[v_longhaul_salesman].active = 'Y'",
    )
  })

  it('emits no leading WHERE so callers can compose it with AND', () => {
    expect(longhaulSalesmanActiveFilter().toLowerCase()).not.toContain('where')
  })
})
