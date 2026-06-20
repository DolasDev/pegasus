// ---------------------------------------------------------------------------
// Event-filter engine — the matcher a workflow EVENT trigger uses to decide
// whether a domain-event payload should fire it. Shared by the dispatcher
// (lambda-dispatch-workflow-triggers.ts) and the trigger create/update
// validation (handlers/workflows.ts), so the contract the API validates is
// byte-for-byte the contract the dispatcher evaluates.
//
// TWO filter dialects, discriminated at runtime so existing rows never break:
//
//   v1 (legacy) — a PLAIN OBJECT of scalar values. SHALLOW TOP-LEVEL STRICT
//   EQUALITY: every key must be present in the payload with a strictly equal
//   (===) scalar value. Extra payload keys are ignored. No nesting, no
//   operators. This is exactly the original matchesTriggerFilter semantics;
//   every trigger created before v2 is a v1 object and keeps working unchanged.
//
//   v2 (structured) — an object discriminated by an `op`, `all`, or `any` key:
//     - FieldRule:  { path: "order.status", op: "eq", value: "DONE" }
//     - Group:      { all: [<node>, ...] }  |  { any: [<node>, ...] }
//   `path` is a dot-path resolved through nested plain objects. Operators:
//   eq, neq, gt, gte, lt, lte (numeric for the comparisons), in, nin
//   (value is a scalar array), contains (string substring), exists (presence;
//   value is an optional boolean, default true). Groups nest arbitrarily.
//
// `op`, `all`, and `any` are therefore RESERVED top-level filter keys — a v1
// filter may not use them (and could not anyway: their value would be an
// object/array, which v1 rejects).
//
// matchesFilter() is the runtime path and MUST NEVER THROW — a malformed
// filter that slipped past validation degrades to "no match", never a crash
// in the dispatcher tick. validateFilterExpr() is the API-layer gate that
// rejects malformed filters at trigger create/update time.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'

/** JSON scalars — the only values a filter compares against. */
export type ScalarValue = string | number | boolean | null

/** v2 comparison operators. */
export const FILTER_OPERATORS = [
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

export type FilterOperator = (typeof FILTER_OPERATORS)[number]

/** A single field comparison against a dot-path in the payload. */
export type FieldRule = {
  path: string
  op: FilterOperator
  value?: ScalarValue | ScalarValue[]
}

/** A boolean combinator over child nodes. Exactly one of all/any. */
export type GroupRule = { all: FilterNode[] } | { any: FilterNode[] }

export type FilterNode = FieldRule | GroupRule

/** Legacy shallow-equality filter: scalar values only. */
export type V1Filter = Record<string, ScalarValue>

/** Either dialect. */
export type FilterExpr = V1Filter | FilterNode

const OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is ScalarValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * Is this filter the v2 (structured) dialect? True iff it is a plain object
 * carrying one of the reserved discriminator keys. Everything else (including
 * a legacy plain-object filter) is v1.
 */
export function isV2Filter(filter: unknown): filter is FilterNode {
  if (!isPlainObject(filter)) return false
  return 'op' in filter || 'all' in filter || 'any' in filter
}

// ── path resolution ────────────────────────────────────────────────────────

type Resolved = { found: boolean; value: unknown }

/**
 * Resolve a dot-path (`"a.b.c"`) through nested plain objects. JSON has no
 * `undefined`, so `found` distinguishes a missing key from a present `null`.
 * Traversal stops (found=false) at the first missing key or non-object node.
 */
export function resolvePath(payload: unknown, path: string): Resolved {
  const segments = path.split('.')
  let current: unknown = payload
  for (const segment of segments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return { found: false, value: undefined }
    }
    current = current[segment]
  }
  return { found: true, value: current }
}

// ── matching (runtime — never throws) ────────────────────────────────────────

function matchV1(filter: Record<string, unknown>, payload: Prisma.JsonValue): boolean {
  const keys = Object.keys(filter)
  if (keys.length === 0) return true
  if (!isPlainObject(payload)) return false
  return keys.every((key) => filter[key] === payload[key])
}

function applyOperator(op: FilterOperator, resolved: Resolved, value: unknown): boolean {
  // `exists` is the only operator that cares about a missing key as a value.
  if (op === 'exists') {
    const want = value === undefined ? true : value === true
    return resolved.found === want
  }
  // Every other operator needs the path to resolve to a present value.
  if (!resolved.found) return false
  const actual = resolved.value

  switch (op) {
    case 'eq':
      return actual === value
    case 'neq':
      return actual !== value
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof value !== 'number') return false
      if (op === 'gt') return actual > value
      if (op === 'gte') return actual >= value
      if (op === 'lt') return actual < value
      return actual <= value
    }
    case 'in':
      return Array.isArray(value) && value.includes(actual as ScalarValue)
    case 'nin':
      return Array.isArray(value) && !value.includes(actual as ScalarValue)
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && actual.includes(value)
    default:
      return false
  }
}

function matchNode(node: FilterNode, payload: Prisma.JsonValue): boolean {
  if ('all' in node) {
    const children = (node as { all: FilterNode[] }).all
    if (!Array.isArray(children)) return false
    return children.every((child) => matchNode(child, payload))
  }
  if ('any' in node) {
    const children = (node as { any: FilterNode[] }).any
    if (!Array.isArray(children)) return false
    return children.some((child) => matchNode(child, payload))
  }
  const rule = node as FieldRule
  if (typeof rule.path !== 'string' || !OPERATOR_SET.has(rule.op)) return false
  return applyOperator(rule.op, resolvePath(payload, rule.path), rule.value)
}

/**
 * Does `payload` satisfy `filter`? A null / non-object / empty filter matches
 * everything (the "no filter" case). Never throws — malformed v2 input that
 * escaped validation simply fails to match.
 */
export function matchesFilter(filter: Prisma.JsonValue | null, payload: Prisma.JsonValue): boolean {
  if (filter === null || !isPlainObject(filter)) {
    // Null / non-object filters mean "no filter".
    return true
  }
  if (isV2Filter(filter)) {
    return matchNode(filter as FilterNode, payload)
  }
  return matchV1(filter, payload)
}

// ── validation (API layer) ───────────────────────────────────────────────────

export type FilterValidationResult = { ok: true } | { ok: false; error: string }

const OK: FilterValidationResult = { ok: true }

function err(error: string): FilterValidationResult {
  return { ok: false, error }
}

function validateFieldRule(rule: Record<string, unknown>): FilterValidationResult {
  if (typeof rule['path'] !== 'string' || rule['path'].length === 0) {
    return err('field rule requires a non-empty string "path"')
  }
  const op = rule['op']
  if (typeof op !== 'string' || !OPERATOR_SET.has(op)) {
    return err(`field rule "op" must be one of: ${FILTER_OPERATORS.join(', ')}`)
  }
  const value = rule['value']
  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      return err(`operator "${op}" requires "value" to be an array of scalars`)
    }
    return OK
  }
  if (op === 'exists') {
    if (value !== undefined && typeof value !== 'boolean') {
      return err('operator "exists" requires "value" to be a boolean (or omitted)')
    }
    return OK
  }
  // Remaining operators take a single scalar.
  if (!isScalar(value)) {
    return err(`operator "${op}" requires a scalar "value"`)
  }
  return OK
}

function validateNode(node: unknown): FilterValidationResult {
  if (!isPlainObject(node)) return err('filter node must be an object')
  const hasAll = 'all' in node
  const hasAny = 'any' in node
  if (hasAll || hasAny) {
    if (hasAll && hasAny) return err('a group may not have both "all" and "any"')
    const children = (hasAll ? node['all'] : node['any']) as unknown
    if (!Array.isArray(children) || children.length === 0) {
      return err(`"${hasAll ? 'all' : 'any'}" must be a non-empty array`)
    }
    for (const child of children) {
      const r = validateNode(child)
      if (!r.ok) return r
    }
    return OK
  }
  if ('op' in node) return validateFieldRule(node)
  return err('filter node must be a field rule (with "op") or a group ("all"/"any")')
}

/**
 * Structural validation for a persisted trigger filter — the gate the trigger
 * create/update handler runs. Accepts both dialects. A null filter (no filter)
 * is valid. v1 filters must be flat objects of scalars.
 */
export function validateFilterExpr(filter: unknown): FilterValidationResult {
  if (filter === null || filter === undefined) return OK
  if (!isPlainObject(filter)) return err('filter must be an object')
  if (isV2Filter(filter)) return validateNode(filter)
  // v1: every value must be a scalar. A nested object/array here is rejected —
  // structured filtering must use the v2 dialect.
  for (const [key, value] of Object.entries(filter)) {
    if (!isScalar(value)) {
      return err(`v1 filter value for "${key}" must be a scalar; use the "op"/"all"/"any" form`)
    }
  }
  return OK
}
