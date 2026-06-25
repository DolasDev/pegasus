// ---------------------------------------------------------------------------
// Shared types for the integration-validation module.
// ---------------------------------------------------------------------------

import type { z } from 'zod'
import type { TransformSpec } from './transform/engine'
import type { MappingTemplate } from './transform/mapping-format'
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

/**
 * Canonical-shaped context handed to fact derivation. Generic over the canonical
 * order type, which differs per integration (each has its own canonical). Each
 * integration's `deriveFacts` narrows `order`/`prior` to its own canonical type.
 */
export interface CanonicalContext<T = unknown> {
  order: T
  prior: T | null
  action: OrderAction
}

/**
 * A complete, declarative description of one integration. The validator is
 * generic over this — nothing about a specific integration is hardcoded in the
 * engine. Keyed by `id` in the registry so adding integration #2 is data, not code.
 *
 * The canonical type varies per integration, so the canonical-typed members use
 * `any`: the structural contract validates the real shape at runtime, and each
 * integration's `deriveFacts` narrows to its own canonical type internally.
 */
export interface IntegrationDefinition {
  id: string
  /** Human-facing label for UI/list surfaces (e.g. "Weichert"). */
  displayName: string
  /** One-line description of what the integration validates. */
  description: string
  /** Structural contract: the canonical Zod schema the transform output must satisfy. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuralContract: z.ZodType<any>
  /** Declarative legacy → canonical mapping, in the output-shaped format (authoring source). */
  mapping: MappingTemplate
  /** The mapping compiled to the engine's per-field spec (derived from `mapping`). */
  transform: TransformSpec
  /** Top-level input field roots the mapping may read (mapping static-check guard). */
  inputFieldRoots?: string[]
  /** Pure derivation of neutral facts from the canonical context. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deriveFacts: (ctx: CanonicalContext<any>) => Facts
  /** The facts this integration's rules may reference (for static checking). */
  factCatalog: FactCatalog
  /** Declarative behavioral rules evaluated against the derived facts. */
  rules: RuleSet
  /** Default action assumed when a caller omits one. */
  defaultAction: OrderAction
}
