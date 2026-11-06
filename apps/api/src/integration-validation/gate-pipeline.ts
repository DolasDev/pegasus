// ---------------------------------------------------------------------------
// Gate pipeline — the deterministic, LLM-free gate a candidate integration
// config must pass before it can be published. It reuses the existing static
// checkers and the golden corpus; nothing here calls a model.
//
// A candidate supplies only the editable surface — `mapping`, `rules`, and a
// bundled golden `corpus`. The ground truth (canonical contract, deriveFacts,
// factCatalog, inputFieldRoots) comes from the built-in `base` definition. The
// pipeline, in order:
//
//   1. mapping format     — MappingTemplateSchema
//   2. mapping analysis    — analyzeMapping (target/source/$map-enum)
//   3. rule format         — RuleSetSchema
//   4. rule analysis       — analyzeRuleSet (+ canonical `field` check)
//   5. compile             — compileMapping → TransformSpec
//   6. structural round-trip — every corpus order parses against the contract
//   7. behavioral corpus   — validateWithDefinition matches each fixture's expected
//
// `ok` is true only when there are no static problems AND every corpus case
// passes. The full report is what the publish endpoint stores as `gateReport`.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { MappingTemplateSchema, compileMapping } from './transform/mapping-format'
import { analyzeMapping, canonicalSchemaPaths } from './transform/mapping-static-check'
import { RuleSetSchema } from './rules/types'
import { analyzeRuleSet } from './static-check'
import { applyMapping } from './transform/engine'
import { validateWithDefinition } from './validate'
import type { TransformSpec } from './transform/engine'
import type { IntegrationDefinition, ValidationInput } from './types'
import { FetchBlockSchema, checkFetchBlock } from '../lib/integration-fetch'

/** A single static-analysis problem, tagged with the stage that produced it. */
export interface GateProblem {
  stage:
    | 'mapping-format'
    | 'mapping'
    | 'rules-format'
    | 'rules'
    | 'external-mapping-format'
    | 'external-mapping'
    | 'external-shape'
    | 'fetch-format'
    | 'fetch'
  where: string
  problem: string
}

/** A golden-corpus case: native order input → expected validation outcome. */
export interface GateCorpusCase {
  name: string
  input: ValidationInput
  expected: { valid: boolean; ruleIds: string[] }
}

/** A corpus case that did not reproduce its expected outcome. */
export interface GateCorpusFailure {
  name: string
  reason: 'structural' | 'behavioral'
  detail: string
  expected?: { valid: boolean; ruleIds: string[] }
  actual?: { valid: boolean; ruleIds: string[]; degraded: boolean }
}

/** The candidate config under test — the editable surface only. */
export interface GateCandidate {
  mapping: unknown
  rules: unknown
  corpus: GateCorpusCase[]
  /**
   * Partner external output shape as a JSON Schema (0020). Required when
   * `externalMapping` is present; absent ⇒ identity (external == canonical).
   */
  externalShape?: Record<string, unknown>
  /** Canonical → external projection (0020). Absent ⇒ identity. */
  externalMapping?: unknown
  /**
   * Declarative PULL descriptor (Gap B): capability name → operation. Absent ⇒
   * this source cannot be pulled generically. Gated here rather than at the HTTP
   * layer because the checks that matter are SEMANTIC — operation names must be
   * capabilities the floor declares, and no credential may be templated into a
   * URL — neither of which a request-body schema can see.
   */
  fetch?: unknown
}

export interface GateReport {
  ok: boolean
  problems: GateProblem[]
  corpus: { total: number; passed: number; failures: GateCorpusFailure[] }
}

function issuePaths(error: z.ZodError): GateProblem[] {
  return error.issues.map((i) => ({
    stage: 'mapping-format' as const,
    where: i.path.join('.') || '(root)',
    problem: i.message,
  }))
}

/**
 * Run the gate over a candidate config against a built-in base definition.
 * Pure and synchronous — safe to call from the dry-run validate endpoint and
 * the publish endpoint alike.
 */
export function runGatePipeline(base: IntegrationDefinition, candidate: GateCandidate): GateReport {
  const problems: GateProblem[] = []
  const canonicalJsonSchema = z.toJSONSchema(base.structuralContract)

  // 1–2. Mapping format + static analysis.
  const mapParsed = MappingTemplateSchema.safeParse(candidate.mapping)
  if (!mapParsed.success) {
    problems.push(...issuePaths(mapParsed.error))
  } else {
    for (const p of analyzeMapping(mapParsed.data, {
      canonicalJsonSchema,
      inputFieldRoots: base.inputFieldRoots,
    })) {
      problems.push({ stage: 'mapping', where: p.where, problem: p.problem })
    }
  }

  // 3–4. Rule format + static analysis (incl. canonical `field` check).
  const rulesParsed = RuleSetSchema.safeParse(candidate.rules)
  if (!rulesParsed.success) {
    for (const i of rulesParsed.error.issues) {
      problems.push({
        stage: 'rules-format',
        where: i.path.join('.') || '(root)',
        problem: i.message,
      })
    }
  } else {
    const validFields = canonicalSchemaPaths(canonicalJsonSchema)
    for (const p of analyzeRuleSet(rulesParsed.data, base.factCatalog, validFields)) {
      problems.push({ stage: 'rules', where: p.ruleId, problem: p.problem })
    }
  }

  // 4b. External projection (0020): canonical → partner external body. When the
  // candidate declares an `externalMapping`, static-check its targets against the
  // declared `externalShape` and its sources against the canonical roots — the
  // same rigor the native→canonical mapping gets, reusing analyzeMapping.
  let externalTransform: TransformSpec | undefined
  if (candidate.externalMapping !== undefined) {
    const extParsed = MappingTemplateSchema.safeParse(candidate.externalMapping)
    if (!extParsed.success) {
      for (const p of issuePaths(extParsed.error)) {
        problems.push({ stage: 'external-mapping-format', where: p.where, problem: p.problem })
      }
    } else if (!candidate.externalShape) {
      problems.push({
        stage: 'external-shape',
        where: '(root)',
        problem: 'externalMapping requires an externalShape to check its targets against',
      })
    } else {
      const canonicalRoots = Object.keys(
        (canonicalJsonSchema as { properties?: Record<string, unknown> }).properties ?? {},
      )
      for (const p of analyzeMapping(extParsed.data, {
        canonicalJsonSchema: candidate.externalShape,
        inputFieldRoots: canonicalRoots,
      })) {
        problems.push({ stage: 'external-mapping', where: p.where, problem: p.problem })
      }
      externalTransform = compileMapping(extParsed.data)
    }
  }

  // 4c. Declarative fetch block (Gap B). Two stages like every other pair:
  // `fetch-format` is the shape (enums, types, unknown keys), `fetch` is the
  // content the shape cannot express — capability names, reserved headers, and
  // the refusal to template a secret into a URL. Both are pure; the gate stays
  // synchronous.
  if (candidate.fetch !== undefined) {
    const fetchParsed = FetchBlockSchema.safeParse(candidate.fetch)
    if (!fetchParsed.success) {
      for (const i of fetchParsed.error.issues) {
        problems.push({
          stage: 'fetch-format',
          where: i.path.join('.') || '(root)',
          problem: i.message,
        })
      }
    } else {
      for (const p of checkFetchBlock(fetchParsed.data, base.capabilities)) {
        problems.push({ stage: 'fetch', where: p.where, problem: p.problem })
      }
    }
  }

  // A malformed mapping or rule set can't be compiled or run — stop before the
  // corpus stages (their results would be meaningless).
  if (!mapParsed.success || !rulesParsed.success) {
    return {
      ok: false,
      problems,
      corpus: { total: candidate.corpus.length, passed: 0, failures: [] },
    }
  }

  // 5. Compile and assemble the candidate definition (ground truth from base).
  const transform = compileMapping(mapParsed.data)
  const candidateDef: IntegrationDefinition = {
    ...base,
    mapping: mapParsed.data,
    transform,
    rules: rulesParsed.data,
  }

  // 6–7. Structural round-trip + behavioral corpus run, per fixture.
  const failures: GateCorpusFailure[] = []
  let passed = 0
  for (const c of candidate.corpus) {
    let mapped: Record<string, unknown>
    try {
      mapped = applyMapping(transform, c.input.order)
    } catch (err) {
      failures.push({ name: c.name, reason: 'structural', detail: String(err) })
      continue
    }
    const parsed = base.structuralContract.safeParse(mapped)
    if (!parsed.success) {
      failures.push({
        name: c.name,
        reason: 'structural',
        detail: parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      })
      continue
    }

    // External round-trip (0020): the canonical must project into the external
    // body without error. A throw here is an authoring bug in externalMapping.
    if (externalTransform) {
      try {
        applyMapping(externalTransform, parsed.data)
      } catch (err) {
        failures.push({ name: c.name, reason: 'structural', detail: `external: ${String(err)}` })
        continue
      }
    }

    const result = validateWithDefinition(candidateDef, c.input)
    const actualIds = result.issues.map((i) => i.ruleId).sort()
    const expectedIds = [...c.expected.ruleIds].sort()
    const matches =
      !result.degraded &&
      result.valid === c.expected.valid &&
      actualIds.length === expectedIds.length &&
      actualIds.every((id, i) => id === expectedIds[i])

    if (matches) {
      passed++
    } else {
      failures.push({
        name: c.name,
        reason: 'behavioral',
        detail: 'validation outcome did not match the expected corpus result',
        expected: c.expected,
        actual: { valid: result.valid, ruleIds: actualIds, degraded: result.degraded },
      })
    }
  }

  return {
    ok: problems.length === 0 && failures.length === 0,
    problems,
    corpus: { total: candidate.corpus.length, passed, failures },
  }
}
