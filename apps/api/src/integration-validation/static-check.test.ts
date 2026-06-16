import { describe, it, expect } from 'vitest'
import { analyzeRuleSet } from './static-check'
import { longhaulRules } from './rules/longhaul.rules'
import { longhaulFactCatalog } from './facts/longhaul-facts'
import type { RuleSet } from './rules/types'

describe('static-check — the AI loop pre-gate', () => {
  it('reports zero problems for the shipped longhaul rule set', () => {
    expect(analyzeRuleSet(longhaulRules, longhaulFactCatalog)).toEqual([])
  })

  it('flags an unknown fact', () => {
    const rules: RuleSet = [
      {
        id: 'r',
        description: 'd',
        field: 'x',
        message: 'm',
        when: [{ fact: 'ghost', op: 'eq', value: 1 }],
      },
    ]
    expect(analyzeRuleSet(rules, longhaulFactCatalog)).toContainEqual({
      ruleId: 'r',
      problem: 'unknown fact "ghost"',
    })
  })

  it('flags a duplicate rule id', () => {
    const rules: RuleSet = [
      {
        id: 'dup',
        description: 'd',
        field: 'x',
        message: 'm',
        when: [{ fact: 'statusId', op: 'eq', value: 1 }],
      },
      {
        id: 'dup',
        description: 'd',
        field: 'y',
        message: 'm',
        when: [{ fact: 'statusId', op: 'eq', value: 2 }],
      },
    ]
    expect(analyzeRuleSet(rules, longhaulFactCatalog)).toContainEqual({
      ruleId: 'dup',
      problem: 'duplicate rule id',
    })
  })

  it('flags an ordered op on a non-numeric fact (a dead rule)', () => {
    const rules: RuleSet = [
      {
        id: 'r',
        description: 'd',
        field: 'x',
        message: 'm',
        when: [{ fact: 'action', op: 'gt', value: 1 }],
      },
    ]
    expect(analyzeRuleSet(rules, longhaulFactCatalog)).toContainEqual({
      ruleId: 'r',
      problem: 'ordered op "gt" on non-numeric fact "action"',
    })
  })

  it('flags a rule shadowed by an earlier one on the same field', () => {
    const rules: RuleSet = [
      {
        id: 'broad',
        description: 'd',
        field: 'driver',
        message: 'm',
        when: [{ fact: 'driverAssigned', op: 'eq', value: false }],
      },
      {
        id: 'narrow',
        description: 'd',
        field: 'driver',
        message: 'm',
        when: [
          { fact: 'driverAssigned', op: 'eq', value: false },
          { fact: 'statusId', op: 'gt', value: 1 },
        ],
      },
    ]
    expect(analyzeRuleSet(rules, longhaulFactCatalog)).toContainEqual({
      ruleId: 'narrow',
      problem: 'shadowed by earlier rule "broad" on field "driver"',
    })
  })
})
