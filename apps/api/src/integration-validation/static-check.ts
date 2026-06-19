// ---------------------------------------------------------------------------
// Static analysis of a rule set — the cheap, mechanical gate the AI loop will
// run BEFORE any golden-corpus test. It needs no order data: it inspects the
// rules as data and reports structural problems.
//
// Checks (POC scope):
//   - format: every rule validates against RuleSchema.
//   - unique ids: no two rules share an id.
//   - known facts: every predicate references a fact in the catalog.
//   - reachable predicates: ordered comparisons (gt/lt/…) target numeric facts;
//     `eq true/false` targets boolean facts — a type mismatch is a dead rule.
//   - shadowing: a rule whose `when` is a superset of an earlier rule's `when`
//     on the same field can never add information beyond it (conflict/redundancy).
//   - canonical field: when `validFields` is supplied (the canonical contract's
//     paths), every rule's `field` must name a real canonical field — otherwise
//     the issue points at a field the validator/output doesn't know.
// ---------------------------------------------------------------------------

import { RuleSchema, type FactCatalog, type Predicate, type RuleSet } from './rules/types'

export interface StaticProblem {
  ruleId: string
  problem: string
}

function predicateKey(p: Predicate): string {
  return `${p.fact}|${p.op}|${JSON.stringify(p.value)}`
}

/**
 * @param validFields when provided, the set of canonical field paths a rule's
 *   `field` may reference (e.g. `canonicalSchemaPaths(z.toJSONSchema(contract))`).
 *   Omit to skip the canonical-field check (back-compat).
 */
export function analyzeRuleSet(
  rules: RuleSet,
  catalog: FactCatalog,
  validFields?: ReadonlySet<string>,
): StaticProblem[] {
  const problems: StaticProblem[] = []
  const seenIds = new Set<string>()
  const predicateSets: Array<{ id: string; field: string; keys: Set<string> }> = []

  for (const rule of rules) {
    const parsed = RuleSchema.safeParse(rule)
    if (!parsed.success) {
      problems.push({
        ruleId: rule.id ?? '(unknown)',
        problem: `invalid format: ${parsed.error.message}`,
      })
      continue
    }

    if (seenIds.has(rule.id)) problems.push({ ruleId: rule.id, problem: 'duplicate rule id' })
    seenIds.add(rule.id)

    if (validFields && !validFields.has(rule.field)) {
      problems.push({
        ruleId: rule.id,
        problem: `field "${rule.field}" is not a canonical field`,
      })
    }

    for (const p of rule.when) {
      const factType = catalog[p.fact]
      if (!factType) {
        problems.push({ ruleId: rule.id, problem: `unknown fact "${p.fact}"` })
        continue
      }
      const ordered = p.op === 'gt' || p.op === 'gte' || p.op === 'lt' || p.op === 'lte'
      if (ordered && factType !== 'number') {
        problems.push({
          ruleId: rule.id,
          problem: `ordered op "${p.op}" on non-numeric fact "${p.fact}"`,
        })
      }
      if (typeof p.value === 'boolean' && factType !== 'boolean') {
        problems.push({
          ruleId: rule.id,
          problem: `boolean compare on non-boolean fact "${p.fact}"`,
        })
      }
    }

    const keys = new Set(rule.when.map(predicateKey))
    for (const prior of predicateSets) {
      if (prior.field !== rule.field) continue
      const priorIsSubset = [...prior.keys].every((k) => keys.has(k))
      if (priorIsSubset) {
        problems.push({
          ruleId: rule.id,
          problem: `shadowed by earlier rule "${prior.id}" on field "${rule.field}"`,
        })
      }
    }
    predicateSets.push({ id: rule.id, field: rule.field, keys })
  }

  return problems
}
