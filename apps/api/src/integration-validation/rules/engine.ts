// ---------------------------------------------------------------------------
// Rule engine: evaluate the decision table against derived facts.
//
// Tiny and bounded on purpose — a closed operator set, scalar facts only, no
// expression language. The result is a deterministic list of behavioral issues.
// ---------------------------------------------------------------------------

import type { ValidationIssue } from '../types'
import type { Facts, FactValue, Predicate, Rule, RuleSet } from './types'

function compare(actual: FactValue, op: Predicate['op'], expected: Predicate['value']): boolean {
  switch (op) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as string | number | boolean)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Ordered comparisons are numbers-only; a non-numeric operand never matches.
      if (typeof actual !== 'number' || typeof expected !== 'number') return false
      if (op === 'gt') return actual > expected
      if (op === 'gte') return actual >= expected
      if (op === 'lt') return actual < expected
      return actual <= expected
    }
    default:
      return false
  }
}

/** True when every predicate holds — i.e. the rule's forbidden condition is met. */
export function ruleFires(rule: Rule, facts: Facts): boolean {
  return rule.when.every((p) => compare(facts[p.fact] ?? null, p.op, p.value))
}

/** Evaluate a whole rule set, returning one issue per fired rule (table order). */
export function evaluateRules(rules: RuleSet, facts: Facts): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const rule of rules) {
    if (ruleFires(rule, facts)) {
      issues.push({
        ruleId: rule.id,
        field: rule.field,
        message: rule.message,
        kind: 'behavioral',
        severity: 'error',
      })
    }
  }
  return issues
}
