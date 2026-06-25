import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { analyzeRuleSet } from './static-check'
import { canonicalSchemaPaths } from './transform/mapping-static-check'
import { listIntegrationIds, getIntegrationDefinition } from './registry'
import type { FactCatalog, RuleSet } from './rules/types'

// Synthetic, integration-agnostic fixtures: analyzeRuleSet is generic engine
// code, so it is exercised against a stand-alone fact catalog + canonical field
// list rather than any one integration's. (Each shipped integration's own rule
// set is checked end-to-end by the data-driven block at the bottom.)
const facts: FactCatalog = { statusId: 'number', action: 'string', driverAssigned: 'boolean' }
const validFields = new Set(['driver', 'shipments', 'status.id'])

describe('static-check — the AI loop pre-gate', () => {
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
    expect(analyzeRuleSet(rules, facts)).toContainEqual({
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
    expect(analyzeRuleSet(rules, facts)).toContainEqual({
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
    expect(analyzeRuleSet(rules, facts)).toContainEqual({
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
    expect(analyzeRuleSet(rules, facts)).toContainEqual({
      ruleId: 'narrow',
      problem: 'shadowed by earlier rule "broad" on field "driver"',
    })
  })

  it('flags a rule whose field is not a canonical field', () => {
    const rules: RuleSet = [
      {
        id: 'r',
        description: 'd',
        field: 'not_a_real_field',
        message: 'm',
        when: [{ fact: 'statusId', op: 'eq', value: 1 }],
      },
    ]
    expect(analyzeRuleSet(rules, facts, validFields)).toContainEqual({
      ruleId: 'r',
      problem: 'field "not_a_real_field" is not a canonical field',
    })
  })

  it('skips the canonical-field check when validFields is omitted (back-compat)', () => {
    const rules: RuleSet = [
      {
        id: 'r',
        description: 'd',
        field: 'not_a_real_field',
        message: 'm',
        when: [{ fact: 'statusId', op: 'eq', value: 1 }],
      },
    ]
    expect(analyzeRuleSet(rules, facts)).toEqual([])
  })
})

describe('every registered integration has canonical rule fields', () => {
  for (const id of listIntegrationIds()) {
    it(`${id}: every rule field exists in its canonical contract`, () => {
      const def = getIntegrationDefinition(id)!
      const fields = canonicalSchemaPaths(z.toJSONSchema(def.structuralContract))
      expect(analyzeRuleSet(def.rules, def.factCatalog, fields)).toEqual([])
    })
  }
})
