// ---------------------------------------------------------------------------
// Behavioral rules format — DATA with a machine-checkable schema.
//
// A rule is a row in a decision table: "when ALL of these predicates hold over
// the derived facts, the order violates an invariant — emit an issue on `field`".
// We encode the FORBIDDEN condition directly. Predicates use a CLOSED operator
// set over scalar facts, so the format is bounded (non-Turing-complete),
// diffable, and statically analyzable — the three properties the AI loop needs.
//
// `RuleSchema` is exported so the format validates itself (and, later, so an AI
// can only emit deltas the schema accepts). CEL is the documented upgrade path
// if cell predicates ever outgrow this operator set — see the POC plan.
// ---------------------------------------------------------------------------

import { z } from 'zod'

export type FactValue = string | number | boolean | null
export type Facts = Record<string, FactValue>

/** Declared fact name → type, so the static checker can catch typos/unknowns. */
export type FactCatalog = Record<string, 'string' | 'number' | 'boolean'>

export const PredicateSchema = z.object({
  fact: z.string().min(1),
  op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]),
})
export type Predicate = z.infer<typeof PredicateSchema>

export const RuleSchema = z.object({
  /** Stable, unique id (the AI loop and golden corpus key off this). */
  id: z.string().min(1),
  description: z.string().min(1),
  /** Canonical order field the resulting issue maps onto. */
  field: z.string().min(1),
  /** Message surfaced to the client when the rule fires. */
  message: z.string().min(1),
  /** Pointer back to the hardcoded guard this rule replaces (provenance). */
  sourceRef: z.string().optional(),
  /** The order VIOLATES the invariant when every predicate is true. */
  when: z.array(PredicateSchema).min(1),
})
export type Rule = z.infer<typeof RuleSchema>

export const RuleSetSchema = z.array(RuleSchema)
export type RuleSet = z.infer<typeof RuleSetSchema>
