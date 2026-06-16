import { describe, it, expect } from 'vitest'
import { evaluateRules, ruleFires } from './engine'
import type { Rule, RuleSet } from './types'

const rule = (id: string, when: Rule['when']): Rule => ({
  id,
  description: id,
  field: 'x',
  message: id,
  when,
})

describe('rule engine', () => {
  it('fires only when every predicate holds', () => {
    const r = rule('r', [
      { fact: 'a', op: 'gte', value: 4 },
      { fact: 'b', op: 'eq', value: true },
    ])
    expect(ruleFires(r, { a: 4, b: true })).toBe(true)
    expect(ruleFires(r, { a: 3, b: true })).toBe(false)
    expect(ruleFires(r, { a: 4, b: false })).toBe(false)
  })

  it('supports the closed operator set', () => {
    expect(ruleFires(rule('r', [{ fact: 'n', op: 'gt', value: 1 }]), { n: 2 })).toBe(true)
    expect(ruleFires(rule('r', [{ fact: 'n', op: 'lt', value: 1 }]), { n: 0 })).toBe(true)
    expect(ruleFires(rule('r', [{ fact: 'n', op: 'ne', value: 1 }]), { n: 2 })).toBe(true)
    expect(ruleFires(rule('r', [{ fact: 's', op: 'in', value: ['a', 'b'] }]), { s: 'b' })).toBe(
      true,
    )
  })

  it('never matches an ordered op against a non-numeric fact', () => {
    expect(ruleFires(rule('r', [{ fact: 's', op: 'gt', value: 1 }]), { s: 'cancel' })).toBe(false)
  })

  it('treats a missing fact as null', () => {
    expect(ruleFires(rule('r', [{ fact: 'missing', op: 'eq', value: null }]), {})).toBe(true)
  })

  it('returns one issue per fired rule, in table order', () => {
    const rules: RuleSet = [
      rule('first', [{ fact: 'a', op: 'eq', value: 1 }]),
      rule('second', [{ fact: 'b', op: 'eq', value: 1 }]),
    ]
    const issues = evaluateRules(rules, { a: 1, b: 1 })
    expect(issues.map((i) => i.ruleId)).toEqual(['first', 'second'])
    expect(issues[0]).toMatchObject({ kind: 'behavioral', severity: 'error', field: 'x' })
  })
})
