import { describe, it, expect } from 'vitest'
import { DomainError } from '../../shared/errors'
import { validateActivityLabor, MAX_ACTIVITY_CREWS } from '../index'

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
