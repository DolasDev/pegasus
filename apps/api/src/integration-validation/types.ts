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
 * A per-*type* fact abstraction — the reusable, partner-neutral half of an
 * integration (sdk-feedback 0020). One floor (e.g. `shipment_status_update`)
 * defines the canonical fact-bearing shape and how facts are derived, and is
 * shared by every partner overlay of that type. It carries NO partner-specific
 * output shape, mapping, or rules — those live in the overlay.
 */
export interface TypeFloor {
  /** Stable type id, e.g. `shipment_status_update`. */
  floor: string
  /** Canonical Zod schema the (native→canonical) mapping output must satisfy. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuralContract: z.ZodType<any>
  /** Top-level input field roots an overlay mapping may read (static-check guard). */
  inputFieldRoots?: string[]
  /** Pure derivation of neutral facts from the canonical context. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deriveFacts: (ctx: CanonicalContext<any>) => Facts
  /** The facts overlay rules may reference (enforced against the overlay). */
  factCatalog: FactCatalog
  /** Default action assumed when a caller omits one. */
  defaultAction: OrderAction
  /** Optional cached-projection binding (keyed off the canonical order). */
  projection?: IntegrationProjectionBinding
}

/**
 * The per-*partner* half of an integration (sdk-feedback 0019 + 0020), authored
 * as a built-in (code) or a published `IntegrationConfig` (DB). It references a
 * `floor` (the reusable type) and carries everything partner-specific: the
 * native→canonical `mapping`, the partner-facing `displayName`, the behavioral
 * `rules`, and — the key 0020 move — the partner's OWN external output shape
 * (`externalShape`) + canonical→external projection (`externalMapping`). A new
 * partner on an existing floor is thus authorable as an overlay alone.
 */
/**
 * A secret/config key an integration declares it reads at runtime (e.g. the
 * delivery API key + URL used by `deliver-to-external`). Purely informational —
 * the runtime read still resolves lazily against the workflow-secrets-configs
 * store — but it powers the tenant's "which keys are set / missing" view. Same
 * shape the workflow manifest uses (see lib/workflow-secret-requirements).
 */
export interface SecretRequirement {
  /** Lookup key, env-var style. */
  key: string
  /** Logical group; defaults to "global" when omitted (matches the store). */
  group?: string
  /** Optional note on what the value is for. */
  description?: string
}

export interface IntegrationOverlay {
  /** Integration id (e.g. `demo_partner`). */
  id: string
  /** The type floor this overlay is built on. */
  floor: string
  /** Human-facing label, decoupled from `id` (0019). */
  displayName: string
  /** One-line description of what the integration validates. */
  description?: string
  /** Declarative native → canonical mapping, in the output-shaped format. */
  mapping: MappingTemplate
  /** Declarative behavioral rules evaluated against the floor's facts. */
  rules: RuleSet
  /**
   * Secret/config keys this integration reads at runtime, declared so the tenant
   * can see and provision them up front. Informational — does not gate anything.
   */
  requiredSecrets?: SecretRequirement[]
  requiredConfigs?: SecretRequirement[]
  /**
   * The partner external output shape, as a JSON Schema. Absent ⇒ the external
   * body IS the canonical (identity) — the pre-0020 behavior. When present, two
   * overlays on the same floor can emit different external shapes.
   */
  externalShape?: Record<string, unknown>
  /**
   * Canonical → partner-external projection. Absent ⇒ identity (external =
   * canonical). Compiled the same way as `mapping`.
   */
  externalMapping?: MappingTemplate
}

/**
 * A complete, declarative description of one integration — the RESOLVED shape a
 * TypeFloor and an IntegrationOverlay compose into (see registry). Consumers
 * (validate, gate, list) use this single object; the floor/overlay split lives
 * at the authoring + DB layer and in `composeDefinition`.
 *
 * The canonical type varies per integration, so the canonical-typed members use
 * `any`: the structural contract validates the real shape at runtime, and each
 * integration's `deriveFacts` narrows to its own canonical type internally.
 */
export interface IntegrationDefinition {
  id: string
  /** The type floor this integration is built on (0020). */
  floor: string
  /** Human-facing label for UI/list surfaces (e.g. "Demo Partner"). */
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
  /**
   * Optional cached-projection binding. When set, the validate endpoint can
   * auto-resolve the record's last-known state (the cached projection) as the
   * `prior` input: it derives the entity key from the canonical order and loads
   * the matching projection row. Absent ⇒ the endpoint stays stateless.
   */
  projection?: IntegrationProjectionBinding
  /**
   * The partner external output shape as a JSON Schema (0020). Absent ⇒ external
   * == canonical (identity). Used by the publish gate to static-check
   * `externalTransform` targets and round-trip the corpus's external bodies.
   */
  externalJsonSchema?: Record<string, unknown>
  /**
   * Canonical → external projection, compiled (0020). Absent ⇒ identity: the
   * external body IS the canonical, byte-identical to the pre-0020 map result.
   */
  externalTransform?: TransformSpec
  /**
   * Secret/config keys this integration reads at runtime (informational). Drives
   * the tenant's present/missing view; resolved against the store separately.
   */
  requiredSecrets?: SecretRequirement[]
  requiredConfigs?: SecretRequirement[]
}

/** Identifies a record so its cached projection can be looked up as `prior`. */
export interface IntegrationProjectionBinding {
  /** Logical entity type, used as the projection's `entityType` key segment. */
  entityType: string
  /**
   * Extract the external record key from the CANONICAL order (post-transform).
   * Return null when the order has no usable key (⇒ skip the lookup).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  key: (order: any) => string | null
}
