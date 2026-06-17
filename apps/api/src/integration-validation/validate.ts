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
 * Validate a native order payload against an integration's declarative
 * definition. Throws only `UnknownIntegrationError` (a caller mistake); every
 * other failure fails open.
 */
export function validateOrder(integrationId: string, input: ValidationInput): ValidationResult {
  const def = getIntegrationDefinition(integrationId)
  if (!def) throw new UnknownIntegrationError(integrationId)

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
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { ...OK, degraded: true }
  }
}
