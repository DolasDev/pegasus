// ---------------------------------------------------------------------------
// Shared types for the integration-validation module.
// ---------------------------------------------------------------------------

import type { z } from 'zod'
import type { CanonicalOrder } from './canonical-order'
import type { TransformSpec } from './transform/engine'
import type { RuleSet, FactCatalog, Facts } from './rules/types'

/** A single validation finding, mapped back onto a canonical order field. */
export interface ValidationIssue {
  /** Which rule / contract check produced this (stable id, for the AI loop). */
  ruleId: string
  /** Canonical order field the issue attaches to (e.g. 'driver', 'shipments'). */
  field: string
  /** Human-readable message, surfaced to the client. */
  message: string
  /** 'structural' = failed the contract; 'behavioral' = failed a rule. */
  kind: 'structural' | 'behavioral'
  severity: 'error'
}

/** The result of validating one order against one integration definition. */
export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  /**
   * True when the validator itself failed internally and we FAILED OPEN — the
   * order was NOT actually checked. Callers treat `valid: true, degraded: true`
   * as "proceed, but the gate did not run". See the POC plan, Phase 1 DoD.
   */
  degraded: boolean
}

/** What the caller submits: the proposed order, optional prior state, the action. */
export interface ValidationInput {
  /** The proposed order, in the INTEGRATION's native payload shape (pre-transform). */
  order: unknown
  /** The order's current persisted state (native shape), for transition rules. */
  prior?: unknown
  /** What the caller is doing — drives action-scoped rules (e.g. cancel). */
  action?: OrderAction
}

export type OrderAction = 'save' | 'cancel' | 'status-change'

/** Canonical-shaped context handed to fact derivation. */
export interface CanonicalContext {
  order: CanonicalOrder
  prior: CanonicalOrder | null
  action: OrderAction
}

/**
 * A complete, declarative description of one integration. The validator is
 * generic over this — nothing about "longhaul" is hardcoded in the engine.
 * Keyed by `id` in the registry so adding integration #2 is data, not code.
 */
export interface IntegrationDefinition {
  id: string
  /** Structural contract: the canonical Zod schema the transform output must satisfy. */
  structuralContract: z.ZodType<CanonicalOrder>
  /** Declarative legacy → canonical mapping. */
  transform: TransformSpec
  /** Pure derivation of neutral facts from the canonical context. */
  deriveFacts: (ctx: CanonicalContext) => Facts
  /** The facts this integration's rules may reference (for static checking). */
  factCatalog: FactCatalog
  /** Declarative behavioral rules evaluated against the derived facts. */
  rules: RuleSet
  /** Default action assumed when a caller omits one. */
  defaultAction: OrderAction
}
