import { describe, it, expect } from 'vitest'
import { coerceListPayload } from './coerce-list-payload'

describe('coerceListPayload', () => {
  it('returns the input when it is an array', () => {
    const input = [1, 2, 3]
    expect(coerceListPayload(input)).toBe(input)
  })

  it('returns [] when the input is null', () => {
    expect(coerceListPayload(null)).toEqual([])
  })

  it('returns [] when the input is undefined', () => {
    expect(coerceListPayload(undefined)).toEqual([])
  })

  it('returns an empty array (not the same reference) on coercion', () => {
    const a = coerceListPayload(null)
    const b = coerceListPayload(null)
    expect(a).toEqual([])
    expect(b).toEqual([])
    // Each call returns a fresh literal, so reducers can safely assign without
    // sharing identity.
    expect(a).not.toBe(b)
  })

  it('preserves array identity when given a valid array (no copy)', () => {
    const input: number[] = []
    expect(coerceListPayload(input)).toBe(input)
  })
})
