import { describe, it, expect } from 'vitest'
import { namesAgree, suggestLocalDriverId } from './local-driver-suggestion'
import type { LonghaulDriver } from '@/api/queries/longhaul-drivers'

const lh = (driver_id: number, driver_name: string): LonghaulDriver => ({
  driver_id,
  driver_name,
  agent_code: null,
  active: 'Y',
  type: 'NW',
})

describe('namesAgree', () => {
  it.each([
    ['TUNYLA, EDWARD', 'Tunyla Jr, Edward M'],
    ['ROBERTS JR, RICHARD', 'Roberts Jr, Richard'],
    ['DE BUHR, DAVID', 'De Buhr, David'],
    ['LEE', 'Lee, Ann'],
  ])('%s matches %s', (local, longhaul) => {
    expect(namesAgree(local, longhaul)).toBe(true)
  })

  it.each([
    ['KENNEDY, BRENT', 'Godin, William (Bill)'],
    ['GONZALES, PRESTON', 'Dion, Mitchell'],
    ['', 'Anyone'],
  ])('%s does not match %s', (local, longhaul) => {
    expect(namesAgree(local, longhaul)).toBe(false)
  })
})

describe('suggestLocalDriverId', () => {
  const longhaul = [lh(134, 'Smith, Pat'), lh(500, 'Godin, William (Bill)')]
  const local = [
    { employeeId: 134, name: 'SMITH, PAT' },
    { employeeId: 500, name: 'KENNEDY, BRENT' },
  ]

  it('suggests the same number when the names agree', () => {
    expect(
      suggestLocalDriverId({ longhaulDriverId: 134, localDriverEmployeeId: null }, longhaul, local),
    ).toBe(134)
  })

  it('does not suggest when the same number is a different person', () => {
    expect(
      suggestLocalDriverId({ longhaulDriverId: 500, localDriverEmployeeId: null }, longhaul, local),
    ).toBeNull()
  })

  it('never overrides an existing mapping, and needs a longhaul mapping to start from', () => {
    expect(
      suggestLocalDriverId({ longhaulDriverId: 134, localDriverEmployeeId: 9 }, longhaul, local),
    ).toBeNull()
    expect(
      suggestLocalDriverId(
        { longhaulDriverId: null, localDriverEmployeeId: null },
        longhaul,
        local,
      ),
    ).toBeNull()
  })

  it('does not suggest when the number has no local record', () => {
    expect(
      suggestLocalDriverId({ longhaulDriverId: 777, localDriverEmployeeId: null }, longhaul, local),
    ).toBeNull()
  })
})
