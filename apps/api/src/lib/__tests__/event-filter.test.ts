// ---------------------------------------------------------------------------
// Unit tests for the event-filter engine (lib/event-filter.ts) — pure, no DB.
//
// Two dialects under one matcher: v1 shallow scalar equality (legacy, must
// stay byte-for-byte compatible) and v2 structured (dot-paths, operators,
// all/any). matchesFilter must never throw; validateFilterExpr is the API gate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  matchesFilter,
  validateFilterExpr,
  isV2Filter,
  resolvePath,
  FILTER_OPERATORS,
} from '../event-filter'

describe('isV2Filter', () => {
  it('flags objects carrying a reserved discriminator key', () => {
    expect(isV2Filter({ op: 'eq', path: 'a', value: 1 })).toBe(true)
    expect(isV2Filter({ all: [] })).toBe(true)
    expect(isV2Filter({ any: [] })).toBe(true)
  })
  it('treats plain scalar objects as v1', () => {
    expect(isV2Filter({ status: 'DONE' })).toBe(false)
    expect(isV2Filter({})).toBe(false)
  })
  it('is false for non-objects', () => {
    expect(isV2Filter(null)).toBe(false)
    expect(isV2Filter([1, 2])).toBe(false)
    expect(isV2Filter('x')).toBe(false)
  })
})

describe('resolvePath', () => {
  it('resolves nested plain-object dot-paths', () => {
    expect(resolvePath({ a: { b: { c: 5 } } }, 'a.b.c')).toEqual({ found: true, value: 5 })
  })
  it('distinguishes a present null from a missing key', () => {
    expect(resolvePath({ a: null }, 'a')).toEqual({ found: true, value: null })
    expect(resolvePath({ a: {} }, 'a.b')).toEqual({ found: false, value: undefined })
  })
  it('stops at a non-object segment', () => {
    expect(resolvePath({ a: 5 }, 'a.b')).toEqual({ found: false, value: undefined })
  })
})

describe('matchesFilter — v1 backward compatibility', () => {
  it('null / empty filter matches everything', () => {
    expect(matchesFilter(null, { anything: true })).toBe(true)
    expect(matchesFilter({}, { anything: true })).toBe(true)
  })
  it('shallow scalar equality across types', () => {
    expect(matchesFilter({ newStatus: 'COMPLETED' }, { newStatus: 'COMPLETED', x: 1 })).toBe(true)
    expect(matchesFilter({ newStatus: 'COMPLETED' }, { newStatus: 'PENDING' })).toBe(false)
    expect(matchesFilter({ count: 3 }, { count: 3 })).toBe(true)
    expect(matchesFilter({ flag: false }, { flag: false })).toBe(true)
    expect(matchesFilter({ nada: null }, { nada: null })).toBe(true)
  })
  it('requires every filter key to be present and equal', () => {
    expect(matchesFilter({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })
  it('non-object payload never matches a non-empty v1 filter', () => {
    expect(matchesFilter({ a: 1 }, 'not-an-object')).toBe(false)
    expect(matchesFilter({ a: 1 }, null)).toBe(false)
  })
})

describe('matchesFilter — v2 operators', () => {
  const payload = {
    status: 'DONE',
    amount: 100,
    label: 'priority-rush',
    order: { region: 'EU' },
    tags: ['a', 'b'],
  }
  it('eq / neq', () => {
    expect(matchesFilter({ path: 'status', op: 'eq', value: 'DONE' }, payload)).toBe(true)
    expect(matchesFilter({ path: 'status', op: 'eq', value: 'OPEN' }, payload)).toBe(false)
    expect(matchesFilter({ path: 'status', op: 'neq', value: 'OPEN' }, payload)).toBe(true)
  })
  it('numeric comparisons', () => {
    expect(matchesFilter({ path: 'amount', op: 'gt', value: 50 }, payload)).toBe(true)
    expect(matchesFilter({ path: 'amount', op: 'gte', value: 100 }, payload)).toBe(true)
    expect(matchesFilter({ path: 'amount', op: 'lt', value: 100 }, payload)).toBe(false)
    expect(matchesFilter({ path: 'amount', op: 'lte', value: 100 }, payload)).toBe(true)
  })
  it('numeric comparison against a non-number is false, not a throw', () => {
    expect(matchesFilter({ path: 'status', op: 'gt', value: 5 }, payload)).toBe(false)
    expect(matchesFilter({ path: 'amount', op: 'gt', value: 'x' }, payload)).toBe(false)
  })
  it('in / nin', () => {
    expect(matchesFilter({ path: 'status', op: 'in', value: ['DONE', 'OPEN'] }, payload)).toBe(true)
    expect(matchesFilter({ path: 'status', op: 'nin', value: ['OPEN'] }, payload)).toBe(true)
    expect(matchesFilter({ path: 'status', op: 'in', value: ['OPEN'] }, payload)).toBe(false)
  })
  it('contains (string substring)', () => {
    expect(matchesFilter({ path: 'label', op: 'contains', value: 'rush' }, payload)).toBe(true)
    expect(matchesFilter({ path: 'label', op: 'contains', value: 'slow' }, payload)).toBe(false)
  })
  it('exists (presence, default true; false to require absence)', () => {
    expect(matchesFilter({ path: 'status', op: 'exists' }, payload)).toBe(true)
    expect(matchesFilter({ path: 'missing', op: 'exists' }, payload)).toBe(false)
    expect(matchesFilter({ path: 'missing', op: 'exists', value: false }, payload)).toBe(true)
    expect(matchesFilter({ path: 'status', op: 'exists', value: false }, payload)).toBe(false)
  })
  it('non-exists operator on a missing path is false', () => {
    expect(matchesFilter({ path: 'missing', op: 'eq', value: 'x' }, payload)).toBe(false)
  })
  it('resolves nested dot-paths', () => {
    expect(matchesFilter({ path: 'order.region', op: 'eq', value: 'EU' }, payload)).toBe(true)
  })
})

describe('matchesFilter — v2 combinators', () => {
  const payload = { status: 'DONE', amount: 100 }
  it('all requires every child to match', () => {
    expect(
      matchesFilter(
        {
          all: [
            { path: 'status', op: 'eq', value: 'DONE' },
            { path: 'amount', op: 'gte', value: 100 },
          ],
        },
        payload,
      ),
    ).toBe(true)
    expect(
      matchesFilter(
        {
          all: [
            { path: 'status', op: 'eq', value: 'DONE' },
            { path: 'amount', op: 'gt', value: 100 },
          ],
        },
        payload,
      ),
    ).toBe(false)
  })
  it('any requires at least one child to match', () => {
    expect(
      matchesFilter(
        {
          any: [
            { path: 'status', op: 'eq', value: 'OPEN' },
            { path: 'amount', op: 'eq', value: 100 },
          ],
        },
        payload,
      ),
    ).toBe(true)
  })
  it('nests groups', () => {
    expect(
      matchesFilter(
        {
          all: [
            { path: 'status', op: 'eq', value: 'DONE' },
            {
              any: [
                { path: 'amount', op: 'gt', value: 999 },
                { path: 'amount', op: 'eq', value: 100 },
              ],
            },
          ],
        },
        payload,
      ),
    ).toBe(true)
  })
})

describe('validateFilterExpr', () => {
  it('accepts null (no filter) and v1 scalar objects', () => {
    expect(validateFilterExpr(null).ok).toBe(true)
    expect(validateFilterExpr({ status: 'DONE', n: 3, b: true, z: null }).ok).toBe(true)
  })
  it('rejects a v1 object with a non-scalar value', () => {
    const r = validateFilterExpr({ nested: { a: 1 } })
    expect(r.ok).toBe(false)
  })
  it('rejects non-objects', () => {
    expect(validateFilterExpr([1, 2]).ok).toBe(false)
    expect(validateFilterExpr('x').ok).toBe(false)
  })
  it('accepts well-formed v2 field rules and groups', () => {
    expect(validateFilterExpr({ path: 'a.b', op: 'eq', value: 1 }).ok).toBe(true)
    expect(validateFilterExpr({ path: 'a', op: 'in', value: ['x', 'y'] }).ok).toBe(true)
    expect(validateFilterExpr({ path: 'a', op: 'exists' }).ok).toBe(true)
    expect(validateFilterExpr({ all: [{ path: 'a', op: 'eq', value: 1 }] }).ok).toBe(true)
  })
  it('rejects an unknown operator', () => {
    expect(validateFilterExpr({ path: 'a', op: 'regex', value: '.*' }).ok).toBe(false)
  })
  it('rejects in/nin without a scalar array', () => {
    expect(validateFilterExpr({ path: 'a', op: 'in', value: 'x' }).ok).toBe(false)
    expect(validateFilterExpr({ path: 'a', op: 'in', value: [{ a: 1 }] }).ok).toBe(false)
  })
  it('rejects a field rule without a path', () => {
    expect(validateFilterExpr({ op: 'eq', value: 1 }).ok).toBe(false)
  })
  it('rejects a group with both all and any, and an empty group', () => {
    expect(validateFilterExpr({ all: [{ path: 'a', op: 'eq', value: 1 }], any: [] }).ok).toBe(false)
    expect(validateFilterExpr({ all: [] }).ok).toBe(false)
  })
  it('rejects an exists value that is not boolean', () => {
    expect(validateFilterExpr({ path: 'a', op: 'exists', value: 'yes' }).ok).toBe(false)
  })
  it('covers the full operator set', () => {
    for (const op of FILTER_OPERATORS) {
      const value = op === 'in' || op === 'nin' ? ['x'] : op === 'exists' ? undefined : 'x'
      expect(validateFilterExpr({ path: 'a', op, value }).ok).toBe(true)
    }
  })
})
