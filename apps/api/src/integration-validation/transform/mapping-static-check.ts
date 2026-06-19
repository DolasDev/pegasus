// ---------------------------------------------------------------------------
// Static analysis of a mapping document — the mechanical gate that makes future
// mappings "guaranteed valid" without running them. Three layers:
//
//   1. FORMAT:    the document validates against the mapping format schema.
//   2. TARGET:    every field the mapping produces exists in the CANONICAL
//                 contract (no mapping to a field the validator doesn't know).
//   3. INPUT:     every top-level source path the mapping reads is a declared
//                 input field (a typo guard; only run when the integration
//                 declares its input field roots).
//
// Layer 2 reads the canonical JSON Schema (z.toJSONSchema of the structural
// contract), so target validation tracks the contract automatically. The runtime
// still validates actual OUTPUT against the contract — this is the pre-flight.
// ---------------------------------------------------------------------------

import {
  MappingTemplateSchema,
  collectMapDirectives,
  collectTargetPaths,
  collectTopLevelSourceRoots,
  type MappingTemplate,
} from './mapping-format'

export interface MappingProblem {
  where: string
  problem: string
}

export interface AnalyzeMappingOptions {
  /** JSON Schema of the canonical output, e.g. `z.toJSONSchema(structuralContract)`. */
  canonicalJsonSchema: unknown
  /** Allowed top-level input field roots (the legacy DTO keys). Optional. */
  inputFieldRoots?: string[] | undefined
}

/** Collect every property/array path in a JSON Schema (arrays marked `[]`). */
function canonicalSchemaPaths(schema: unknown): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    for (const comb of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = n[comb]
      if (Array.isArray(branches)) branches.forEach((s) => walk(s, prefix))
    }
    const props = n['properties']
    if (props && typeof props === 'object') {
      for (const [key, sub] of Object.entries(props)) {
        const path = prefix ? `${prefix}.${key}` : key
        out.add(path)
        walk(sub, path)
      }
    }
    if (n['items']) walk(n['items'], `${prefix}[]`)
  }
  walk(schema, '')
  return out
}

/** The enum `const` set at a node, looking through `anyOf`/`oneOf`/`allOf` branches. */
function enumOf(node: unknown): string[] | null {
  if (!node || typeof node !== 'object') return null
  const n = node as Record<string, unknown>
  if (Array.isArray(n['enum'])) return (n['enum'] as unknown[]).map(String)
  for (const comb of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = n[comb]
    if (Array.isArray(branches)) {
      for (const b of branches) {
        const e = enumOf(b)
        if (e) return e
      }
    }
  }
  return null
}

/** Map every enum-constrained leaf path to its allowed (string-coerced) values. */
function canonicalSchemaEnums(schema: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    for (const comb of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = n[comb]
      if (Array.isArray(branches)) branches.forEach((s) => walk(s, prefix))
    }
    const props = n['properties']
    if (props && typeof props === 'object') {
      for (const [key, sub] of Object.entries(props)) {
        const path = prefix ? `${prefix}.${key}` : key
        const e = enumOf(sub)
        if (e) out.set(path, new Set(e))
        walk(sub, path)
      }
    }
    if (n['items']) walk(n['items'], `${prefix}[]`)
  }
  walk(schema, '')
  return out
}

/** Analyze a mapping document; returns [] when it is statically valid. */
export function analyzeMapping(template: unknown, opts: AnalyzeMappingOptions): MappingProblem[] {
  const parsed = MappingTemplateSchema.safeParse(template)
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      where: i.path.join('.') || '(root)',
      problem: `invalid mapping format: ${i.message}`,
    }))
  }

  const tmpl = parsed.data as MappingTemplate
  const problems: MappingProblem[] = []

  const validTargets = canonicalSchemaPaths(opts.canonicalJsonSchema)
  for (const target of collectTargetPaths(tmpl)) {
    if (!validTargets.has(target)) {
      problems.push({ where: target, problem: `maps to unknown canonical field "${target}"` })
    }
  }

  if (opts.inputFieldRoots) {
    const allowed = new Set(opts.inputFieldRoots)
    for (const root of collectTopLevelSourceRoots(tmpl)) {
      if (!allowed.has(root)) {
        problems.push({ where: root, problem: `reads undeclared input field "${root}"` })
      }
    }
  }

  // `$map` value translation: scalar-leaf only, and (when the target field is an
  // enum in the contract) every output must be a member of that enum.
  const enums = canonicalSchemaEnums(opts.canonicalJsonSchema)
  for (const md of collectMapDirectives(tmpl)) {
    if (md.withEach) {
      problems.push({
        where: md.to,
        problem: '$map cannot be combined with $each (value translation is scalar-only)',
      })
      continue
    }
    const allowed = enums.get(md.to)
    if (!allowed) continue
    for (const out of md.outputs) {
      if (out != null && !allowed.has(String(out))) {
        problems.push({
          where: md.to,
          problem: `$map output "${String(out)}" is not a valid "${md.to}" value (allowed: ${[...allowed].join(', ')})`,
        })
      }
    }
  }

  return problems
}
