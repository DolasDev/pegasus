// ---------------------------------------------------------------------------
// validateOrder — the reusable validation core. ONE function, called both by the
// HTTP endpoint (WinForms-facing) and in-process by the cloud save path. This is
// the POC's core novel surface: synchronous, integration-agnostic validation.
//
// Pipeline:  native order  --transform-->  canonical
//            canonical      --contract-->  structural issues (and stop if shape is broken)
//            context        --facts-->     neutral facts
//            facts          --rules-->     behavioral issues
//
// FAIL-OPEN is baked in here, not left to callers: any internal error (bad
// transform, schema blow-up, rule bug) yields `{ valid: true, degraded: true }`
// so a validator defect can never freeze a save. A caller that wants to fail
// CLOSED can inspect `degraded`. See POC plan, Phase 1 DoD.
// ---------------------------------------------------------------------------

import { getIntegrationDefinition } from './registry'
import { applyMapping } from './transform/engine'
import { evaluateRules } from './rules/engine'
import { logger } from '../lib/logger'
import type {
  CanonicalContext,
  IntegrationDefinition,
  OrderAction,
  ValidationInput,
  ValidationIssue,
  ValidationResult,
} from './types'

export class UnknownIntegrationError extends Error {
  constructor(public readonly integrationId: string) {
    super(`Unknown integration "${integrationId}"`)
    this.name = 'UnknownIntegrationError'
  }
}

const OK: ValidationResult = { valid: true, issues: [], degraded: false }

function transformToCanonical(
  def: IntegrationDefinition,
  native: unknown,
): { ok: true; order: unknown } | { ok: false; issues: ValidationIssue[] } {
  const mapped = applyMapping(def.transform, native)
  const parsed = def.structuralContract.safeParse(mapped)
  if (parsed.success) return { ok: true, order: parsed.data }
  const issues: ValidationIssue[] = parsed.error.issues.map((i) => ({
    ruleId: 'structural-contract',
    field: i.path.join('.') || '(root)',
    message: i.message,
    kind: 'structural',
    severity: 'error',
  }))
  return { ok: false, issues }
}

/**
 * Transform a native order payload to its canonical shape using an integration
 * definition, returning the parsed canonical order or null when the payload
 * can't be mapped/parsed. Exposed so the validate endpoint can derive a
 * projection key from the canonical order before validating. Never throws.
 */
export function transformOrderToCanonical(def: IntegrationDefinition, native: unknown): unknown {
  try {
    const result = transformToCanonical(def, native)
    return result.ok ? result.order : null
  } catch {
    return null
  }
}

/**
 * Validate a native order payload against an EXPLICIT integration definition —
 * the registry-free core. Used by `validateOrder` (after registry lookup) and by
 * the gate pipeline, which validates a *candidate* config that isn't registered.
 * Fails open on any internal error (`valid: true, degraded: true`).
 */
export function validateWithDefinition(
  def: IntegrationDefinition,
  input: ValidationInput,
): ValidationResult {
  try {
    const orderResult = transformToCanonical(def, input.order)
    if (!orderResult.ok) {
      // Shape is broken — behavioral rules can't be trusted, so report structure only.
      return { valid: false, issues: orderResult.issues, degraded: false }
    }

    let prior: unknown = null
    if (input.prior !== undefined && input.prior !== null) {
      const priorResult = transformToCanonical(def, input.prior)
      // A malformed PRIOR is not the caller's fault to fix here; skip transition
      // rules rather than blocking the save on it.
      if (priorResult.ok) prior = priorResult.order
    }

    const ctx: CanonicalContext = {
      order: orderResult.order,
      prior,
      action: input.action ?? def.defaultAction,
    }
    const issues = evaluateRules(def.rules, def.deriveFacts(ctx))
    return { valid: issues.length === 0, issues, degraded: false }
  } catch (err) {
    logger.error('integration validation failed open', {
      integrationId: def.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { ...OK, degraded: true }
  }
}

/**
 * Validate a native order payload against an integration's registered
 * definition. Throws only `UnknownIntegrationError` (a caller mistake); every
 * other failure fails open.
 */
export function validateOrder(integrationId: string, input: ValidationInput): ValidationResult {
  const def = getIntegrationDefinition(integrationId)
  if (!def) throw new UnknownIntegrationError(integrationId)
  return validateWithDefinition(def, input)
}

// ---------------------------------------------------------------------------
// mapToExternal — the outbound half of the anti-corruption layer, exposed.
//
// Two-stage projection (sdk-feedback 0020): the overlay's `transform` runs
// native → CANONICAL (the floor's neutral fact shape), then the overlay's
// optional `externalTransform` projects CANONICAL → the partner EXTERNAL body.
// When `externalTransform` is absent the external body IS the canonical
// (identity) — the pre-0020 behavior, byte-identical. validateOrder runs the
// native→canonical transform internally for its verdict; this additionally
// returns the external payload so a workflow can CALL the partner API and gate
// the send on `valid`.
//
// `external` is the projected output — always returned (even when it fails the
// contract or a rule), so the caller can inspect/send it regardless. A hard
// mapping error (e.g. an unknown coercion) yields `external: null`. Merging into
// a cached projection is intentionally NOT done here — a workflow composes
// get_projection → this → merge (in Python) → put_projection itself.
// ---------------------------------------------------------------------------

export interface MapToExternalResult {
  /** The entity data projected into the integration's external payload shape. */
  external: Record<string, unknown> | null
  /** Whether `external` passed the integration's structural contract + rules. */
  valid: boolean
  /** Findings when `valid` is false (empty otherwise). */
  issues: ValidationIssue[]
  /** True when validation failed open internally (the gate did not actually run). */
  degraded: boolean
}

export function mapToExternalWithDefinition(
  def: IntegrationDefinition,
  data: unknown,
  action?: OrderAction,
): MapToExternalResult {
  // External payload — returned even if it later fails validation. A defect in
  // either transform must not deny the caller a verdict, so fall back to null.
  // Stage 1: native → canonical. Stage 2 (optional): canonical → external; when
  // there is no external transform the canonical IS the external body (identity).
  let external: Record<string, unknown> | null = null
  try {
    const canonical = applyMapping(def.transform, data)
    external = def.externalTransform ? applyMapping(def.externalTransform, canonical) : canonical
  } catch (err) {
    logger.warn('integration map-to-external transform failed', {
      integrationId: def.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Build the input conditionally: with exactOptionalPropertyTypes, an explicit
  // `action: undefined` is not assignable to the optional `action?`.
  const input: ValidationInput = { order: data }
  if (action !== undefined) input.action = action
  const result = validateWithDefinition(def, input)
  return { external, valid: result.valid, issues: result.issues, degraded: result.degraded }
}

export function mapToExternal(
  integrationId: string,
  data: unknown,
  action?: OrderAction,
): MapToExternalResult {
  const def = getIntegrationDefinition(integrationId)
  if (!def) throw new UnknownIntegrationError(integrationId)
  return mapToExternalWithDefinition(def, data, action)
}

// ---------------------------------------------------------------------------
// mapFromExternal — the INBOUND half of the anti-corruption layer, exposed
// (sdk-feedback 0024). The inbound mirror of mapToExternal: run a partner's
// NATIVE payload through the integration's mapping to get the normalized
// CANONICAL entity, plus the same gate verdict. An ingest workflow (0021's
// inbound events → this → persist to a projection) uses `canonical` as the
// system-of-record shape and `valid`/`issues` to fail closed on a bad payload.
//
// Unlike mapToExternal (which returns the partner-external body), this returns
// the CANONICAL entity — the value the outbound direction discards inside
// validateWithDefinition. `canonical` is null when the payload can't be
// mapped/parsed (a hard transform error or a broken structural shape), so a
// caller can fail closed rather than persist an empty entity.
// ---------------------------------------------------------------------------

export interface MapFromExternalResult {
  /** The native payload normalized to the integration's canonical entity, or null. */
  canonical: Record<string, unknown> | null
  /** Whether the payload passed the integration's structural contract + rules. */
  valid: boolean
  /** Findings when `valid` is false (empty otherwise). */
  issues: ValidationIssue[]
  /** True when validation failed open internally (the gate did not actually run). */
  degraded: boolean
}

export function mapFromExternalWithDefinition(
  def: IntegrationDefinition,
  data: unknown,
): MapFromExternalResult {
  // The canonical entity (native → canonical), or null on a hard transform/parse
  // failure — transformOrderToCanonical never throws.
  const canonical = transformOrderToCanonical(def, data)
  const result = validateWithDefinition(def, { order: data })
  return {
    canonical: (canonical as Record<string, unknown> | null) ?? null,
    valid: result.valid,
    issues: result.issues,
    degraded: result.degraded,
  }
}

export function mapFromExternal(integrationId: string, data: unknown): MapFromExternalResult {
  const def = getIntegrationDefinition(integrationId)
  if (!def) throw new UnknownIntegrationError(integrationId)
  return mapFromExternalWithDefinition(def, data)
}
