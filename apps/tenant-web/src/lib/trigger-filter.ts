// ---------------------------------------------------------------------------
// Client-side validation for EVENT-trigger filters.
//
// Two dialects, matching apps/api/src/lib/event-filter.ts:
//   v1 (legacy) — a flat object of scalars; shallow top-level strict equality.
//   v2 (structured) — discriminated by an `op`/`all`/`any` key: dot-path field
//     rules with operators (eq/neq/gt/gte/lt/lte/in/nin/contains/exists) and
//     all/any combinators.
// An empty/absent filter matches every event of the subscribed type.
//
// The server's validateFilterExpr is authoritative; this is a fast pre-check so
// users get an error before the round-trip and don't create dead triggers.
// ---------------------------------------------------------------------------

const FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'exists',
] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isScalar(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}

function isV2(filter: Record<string, unknown>): boolean {
  return 'op' in filter || 'all' in filter || 'any' in filter
}

/** Validate a v2 node (field rule or all/any group). Returns an error or null. */
function validateV2Node(node: unknown): string | null {
  if (!isPlainObject(node)) return 'Each filter node must be an object.'
  const hasAll = 'all' in node
  const hasAny = 'any' in node
  if (hasAll || hasAny) {
    if (hasAll && hasAny) return 'A group cannot have both "all" and "any".'
    const children = (hasAll ? node['all'] : node['any']) as unknown
    if (!Array.isArray(children) || children.length === 0) {
      return `"${hasAll ? 'all' : 'any'}" must be a non-empty array.`
    }
    for (const child of children) {
      const err = validateV2Node(child)
      if (err) return err
    }
    return null
  }
  if (!('op' in node)) return 'A filter node needs an "op" (field rule) or "all"/"any" (group).'
  if (typeof node['path'] !== 'string' || node['path'].length === 0) {
    return 'A field rule needs a non-empty "path".'
  }
  const op = node['op']
  if (typeof op !== 'string' || !FILTER_OPERATORS.includes(op as never)) {
    return `Unknown operator — use one of: ${FILTER_OPERATORS.join(', ')}.`
  }
  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(node['value']) || !node['value'].every(isScalar)) {
      return `Operator "${op}" needs "value" to be an array of scalars.`
    }
  } else if (op === 'exists') {
    if (node['value'] !== undefined && typeof node['value'] !== 'boolean') {
      return 'Operator "exists" needs a boolean "value" (or none).'
    }
  } else if (!isScalar(node['value'])) {
    return `Operator "${op}" needs a scalar "value".`
  }
  return null
}

export type TriggerFilterValidation =
  | {
      ok: true
      /** The parsed filter, or undefined when empty (= match-all; omit from the request). */
      filter: Record<string, unknown> | undefined
    }
  | { ok: false; error: string }

/**
 * Parses + validates the filter textarea contents. Empty text and `{}` are
 * valid and mean "match every event" (returned as `undefined` so callers omit
 * the field from the create request).
 */
export function parseTriggerFilter(text: string): TriggerFilterValidation {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, filter: undefined }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Filter must be valid JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Filter must be a JSON object (e.g. {"status": "COMPLETED"}).' }
  }

  const filter = parsed as Record<string, unknown>

  // v2 structured dialect (operators + combinators).
  if (isV2(filter)) {
    const err = validateV2Node(filter)
    if (err) return { ok: false, error: err }
    return { ok: true, filter }
  }

  // v1 legacy dialect: flat object of scalars.
  const keys = Object.keys(filter)
  if (keys.length === 0) return { ok: true, filter: undefined }

  for (const key of keys) {
    const value = filter[key]
    // Scalars only — strict equality against nested objects/arrays can never
    // match a payload value, so such a filter would silently never fire.
    if (typeof value === 'object' && value !== null) {
      return {
        ok: false,
        error: `Filter values must be scalars (string, number, boolean, or null) — "${key}" is ${
          Array.isArray(value) ? 'an array' : 'an object'
        }. Use the {"op": ...} form for structured matching.`,
      }
    }
  }

  return { ok: true, filter }
}
