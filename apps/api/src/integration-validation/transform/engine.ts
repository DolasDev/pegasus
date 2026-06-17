// ---------------------------------------------------------------------------
// Declarative transform engine (the anti-corruption layer's translation half).
//
// A TransformSpec is DATA, not code: a flat list of per-field mappings. We
// deliberately prefer this over one large opaque expression (JSONata/CEL blob)
// so a mapping is diffable line-by-line and — later — an AI can emit a single
// field delta the schema can validate. See the POC plan's engine recommendation.
//
// Each mapping reads one of a fallback chain of source paths, optionally coerces
// it, and writes it to a target path. Arrays are mapped element-wise via `each`.
// Bounded by design: no conditionals, no loops, no arithmetic — just project +
// coerce. Anything richer is a deliberate escalation, not a silent capability.
// ---------------------------------------------------------------------------

export type CoerceName = 'toNumber' | 'toNumberOrNull' | 'toString' | 'identity'

export interface FieldMapping {
  /** Dot-path to write in the canonical output (e.g. 'status.id'). */
  to: string
  /** Source dot-path(s); the first that resolves to a defined value wins. */
  from: string[]
  /** Value used when no `from` path resolves (and there is no value). */
  default?: unknown
  /** Optional coercion applied to the resolved (or default) value. */
  coerce?: CoerceName
  /** For array targets: map each source element through this sub-spec. */
  each?: FieldMapping[]
}

export type TransformSpec = FieldMapping[]

const COERCIONS: Record<CoerceName, (v: unknown) => unknown> = {
  identity: (v) => v,
  toString: (v) => (v == null ? v : String(v)),
  toNumber: (v) => Number(v),
  toNumberOrNull: (v) => (v == null ? null : Number(v)),
}

// Dotted access with two extensions used by real integration mappings:
//   - "."        — identity: resolves to the whole input object (e.g. mapping a
//                  single root object into a one-element array via `$each`).
//   - "a.b[0].c" — array index access on a path segment (e.g. `DocumentationDates[0]`).
function getPath(obj: unknown, path: string): unknown {
  if (path === '.' || path === '') return obj
  if (obj == null) return undefined
  let cur: unknown = obj
  for (const segment of path.split('.')) {
    const key = segment.replace(/\[\d+\]/g, '')
    if (key) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
    for (const m of segment.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined
      cur = cur[Number(m[1])]
    }
  }
  return cur
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]!] = value
}

/** Resolve the first defined value across a mapping's `from` chain. */
function resolveSource(input: unknown, m: FieldMapping): { found: boolean; value: unknown } {
  for (const path of m.from) {
    const v = getPath(input, path)
    if (v !== undefined) return { found: true, value: v }
  }
  return { found: false, value: undefined }
}

function applyOne(input: unknown, m: FieldMapping): unknown {
  const { found, value } = resolveSource(input, m)
  let resolved = found ? value : m.default

  if (m.each) {
    // An array source maps element-wise; a single object source is treated as a
    // one-element collection (the root-object-as-one-shipment pattern, used with
    // `$from: "."`); anything else yields an empty list.
    const arr = Array.isArray(resolved)
      ? resolved
      : resolved != null && typeof resolved === 'object'
        ? [resolved]
        : []
    return arr.map((el) => applyMapping(m.each!, el))
  }

  if (m.coerce) {
    const fn = COERCIONS[m.coerce]
    if (!fn) throw new Error(`Unknown coercion "${m.coerce}" in transform`)
    resolved = fn(resolved)
  }
  return resolved
}

/** Apply a transform spec, producing the canonical-shaped object. */
export function applyMapping(spec: TransformSpec, input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of spec) setPath(out, m.to, applyOne(input, m))
  return out
}
