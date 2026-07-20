// ---------------------------------------------------------------------------
// Static analysis of a mapping document — the mechanical gate that makes future
// mappings "guaranteed valid" without running them. Three layers:
//
//   1. FORMAT:    the document validates against the mapping format schema.
//   2. TARGET:    every field the mapping produces exists in the CANONICAL
//                 contract (no mapping to a field the validator doesn't know).
//   3. INPUT:     every order-scope source path the mapping reads is covered by
//                 a declared input field root (a typo guard; only run when the
//                 integration declares its input field roots). A declared entry
//                 with NO dot opens a whole top-level root (`Survey`); an entry
//                 WITH a dot opens only that exact path and its descendants
//                 (`UnusedFields.survey_received`), leaving the rest of an
//                 otherwise-closed root shut.
//
// Layer 2 reads the canonical JSON Schema (z.toJSONSchema of the structural
// contract), so target validation tracks the contract automatically. The runtime
// still validates actual OUTPUT against the contract — this is the pre-flight.
// ---------------------------------------------------------------------------

import {
  MappingTemplateSchema,
  collectMapDirectives,
  collectTargetPaths,
  collectTopLevelSourcePaths,
  type MappingTemplate,
} from './mapping-format'

export interface MappingProblem {
  where: string
  problem: string
}

export interface AnalyzeMappingOptions {
  /** JSON Schema of the canonical output, e.g. `z.toJSONSchema(structuralContract)`. */
  canonicalJsonSchema: unknown
  /**
   * Allowed input field roots (the legacy DTO keys). A bare key (`Survey`) opens
   * a whole top-level root; a dotted key (`UnusedFields.survey_received`) opens
   * only that specific path + its descendants. Optional.
   */
  inputFieldRoots?: string[] | undefined
}

/** Collect every property/array path in a JSON Schema (arrays marked `[]`). */
export function canonicalSchemaPaths(schema: unknown): Set<string> {
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

/** Strip array-index suffixes (`[0]`) so path matching is index-agnostic. */
function normalizeInputPath(path: string): string {
  return path.replace(/\[\d+\]/g, '')
}

/**
 * Is an order-scope source path covered by the declared input-field allowlist?
 * A declared entry with NO dot is a whole-root grant (its top-level key opens
 * every path beneath it). A declared entry WITH a dot is a specific-path grant:
 * it opens only that exact path and its descendants, so a sibling under the same
 * root (`UnusedFields.truck_name`) or a bare read of the root itself stays closed.
 */
function inputPathAllowed(path: string, allowed: readonly string[]): boolean {
  const p = normalizeInputPath(path)
  const firstSeg = p.split('.')[0]!
  for (const raw of allowed) {
    const entry = normalizeInputPath(raw)
    if (!entry.includes('.')) {
      if (firstSeg === entry) return true // whole-root grant
    } else if (p === entry || p.startsWith(`${entry}.`)) {
      return true // specific-path grant (exact or descendant)
    }
  }
  return false
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
    const allowed = opts.inputFieldRoots
    const reported = new Set<string>()
    for (const path of collectTopLevelSourcePaths(tmpl)) {
      if (!inputPathAllowed(path, allowed)) {
        // Report against the top-level root (matches the gate's historical
        // wording and de-dups repeated reads under the same closed root).
        const root = normalizeInputPath(path).split('.')[0]!
        if (!reported.has(root)) {
          reported.add(root)
          problems.push({ where: root, problem: `reads undeclared input field "${root}"` })
        }
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
