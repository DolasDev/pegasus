import { describe, it, expect } from 'vitest'
import { DomainError } from '../../shared/errors'
import {
  validateActivityLabor,
  MAX_ACTIVITY_CREWS,
  MAX_CREW_MEMBERS,
  isLaborActivityType,
  isTripConfirmTransition,
  validateActivityMembers,
} from '../index'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    if (err instanceof DomainError) return err.code
    throw err
  }
  return undefined
}

describe('validateActivityLabor', () => {
  it('normalises crew phones and keeps packer ids', () => {
    expect(validateActivityLabor([{ phone: '(404) 555-1212', packerIds: ['p1', 'p2'] }])).toEqual([
      { phone: '+14045551212', packerIds: ['p1', 'p2'] },
    ])
  })

  it('accepts an empty set (every crew removed)', () => {
    expect(validateActivityLabor([])).toEqual([])
  })

  it('drops repeated packer ids within a crew', () => {
    expect(validateActivityLabor([{ phone: '+14045551212', packerIds: ['p1', 'p1'] }])).toEqual([
      { phone: '+14045551212', packerIds: ['p1'] },
    ])
  })

  it('rejects the same crew twice, however it is spelled', () => {
    expect(
      codeOf(() =>
        validateActivityLabor([
          { phone: '404-555-1212', packerIds: [] },
          { phone: '+1 404 555 1212', packerIds: [] },
        ]),
      ),
    ).toBe('DUPLICATE_ACTIVITY_CREW')
  })

  it('rejects one packer on two crews', () => {
    expect(
      codeOf(() =>
        validateActivityLabor([
          { phone: '404-555-1212', packerIds: ['p1'] },
          { phone: '404-555-1313', packerIds: ['p1'] },
        ]),
      ),
    ).toBe('DUPLICATE_ACTIVITY_PACKER')
  })

  it(`caps an activity at ${MAX_ACTIVITY_CREWS} crews`, () => {
    const crews = Array.from({ length: MAX_ACTIVITY_CREWS + 1 }, (_, i) => ({
      phone: `404555${String(1000 + i)}`,
      packerIds: [],
    }))
    expect(codeOf(() => validateActivityLabor(crews))).toBe('TOO_MANY_ACTIVITY_CREWS')
  })

  it('rejects a bad phone', () => {
    expect(codeOf(() => validateActivityLabor([{ phone: '12', packerIds: [] }]))).toBe(
      'INVALID_PHONE_NUMBER',
    )
  })
})

describe('isLaborActivityType', () => {
  it('matches pack, load, unpack and the deliveries, padded or not', () => {
    for (const code of ['PACK', 'LOAD', 'UNPK', 'RDEL', 'XDEL', 'PACK  ', 'pack']) {
      expect(isLaborActivityType(code)).toBe(true)
    }
  })

  it('skips every other type and a missing code', () => {
    for (const code of ['XPU', 'R19I', 'R19O', 'WHSE', 'SITIN', 'SITOUT', '', null, undefined]) {
      expect(isLaborActivityType(code)).toBe(false)
    }
  })
})

describe('isTripConfirmTransition', () => {
  it('is Pending/Offered into Accepted/In-Progress, nothing else', () => {
    const confirms: string[] = []
    for (let from = 0; from <= 5; from++) {
      for (let to = 0; to <= 5; to++) {
        if (isTripConfirmTransition(from, to)) confirms.push(`${from}->${to}`)
      }
    }
    expect(confirms).toEqual(['1->3', '1->4', '2->3', '2->4'])
  })
})

describe('validateActivityMembers', () => {
  it('drops repeats', () => {
    expect(validateActivityMembers(['m1', 'm2', 'm1'])).toEqual(['m1', 'm2'])
  })

  it(`rejects more than ${MAX_CREW_MEMBERS}`, () => {
    const ids = Array.from({ length: MAX_CREW_MEMBERS + 1 }, (_, i) => `m${i}`)
    expect(codeOf(() => validateActivityMembers(ids))).toBe('TOO_MANY_ACTIVITY_MEMBERS')
  })
})
