// ---------------------------------------------------------------------------
// Integration mapping format — the OUTPUT-SHAPED declarative mapping document.
//
// A mapping is a JSON object whose SHAPE MIRRORS THE CANONICAL OUTPUT. Each leaf
// says where its value comes from in the (legacy) input:
//
//   {
//     "status": { "code": "status_code",                       // string = source path
//                 "name": { "$from": "status.label", "default": null } },
//     "shipments": { "$from": "shipments",
//                    "$each": { "orderNum": { "$from": "order_num", "coerce": "toNumber" } } },
//     "packDateActual": { "$from": "pack_actual_dt", "coerce": "toString" }
//   }
//
// Rules of the form:
//   - a plain STRING leaf is a source path (shorthand for { "$from": <path> }).
//   - a DIRECTIVE object carries "$from" (string | string[] fallback chain) plus
//     optional "default", "$map" (finite value-translation table), "coerce" (incl.
//     the date reformatters), and "$each" (per-element sub-template for arrays).
//   - any other OBJECT is a nested canonical object (its keys are output fields).
//
// This is intentionally NOT an expression language (no conditionals/functions):
// bounded, diffable per leaf, schema-validatable, and AI-delta-friendly. CEL /
// JSONata remain the documented escape hatch for a field that needs real logic.
//
// The format is COMPILED to the per-field TransformSpec the engine already runs,
// so nothing in the evaluator changes. `MappingTemplateSchema` validates a
// document; `mappingFormatJsonSchema()` exports the published JSON Schema.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { CoerceName, FieldMapping, TransformSpec } from './engine'

// --- Types -----------------------------------------------------------------

/** A JSON scalar — the only thing a `$map` may translate a value to. */
export type MapScalar = string | number | boolean | null

export interface MappingDirective {
  /** Source path, or a fallback chain (first path that resolves wins). */
  $from: string | string[]
  /** Value used when no `$from` path resolves. */
  default?: unknown
  /**
   * Value-translation table: source value (stringified) → output value, e.g.
   * `{ "Active": "A" }`. Scalar-leaf only (not with `$each`). A miss falls back to
   * `default` if present, else passes the value through. Bounded — a finite lookup,
   * not an expression language; the static checker validates outputs against the
   * target field's enum when the canonical contract declares one.
   */
  $map?: Record<string, MapScalar> | undefined
  /**
   * Coercion applied to the resolved (or default) value, AFTER `$map`. Includes
   * the date reformatters `toDateOnly` / `toIsoDateTime`, which truncate
   * wall-clock calendar fields without any timezone conversion (see `engine.ts`).
   */
  coerce?: CoerceName | undefined
  /** For an array target: map each source element through this sub-template. */
  $each?: MappingObject | undefined
}

export type MappingNode = string | MappingDirective | MappingObject
export interface MappingObject {
  [field: string]: MappingNode
}
/** A complete mapping document (the canonical-output-shaped template). */
export type MappingTemplate = MappingObject

// --- Schema (runtime validation) -------------------------------------------

// The coercion vocabulary. Closed by design — but it carries its own semantics in
// the PUBLISHED schema (`.describe()` → `description`), because "toDateOnly" alone
// doesn't say whether it shifts timezones or what it does with junk input, and an
// authoring agent reads the schema endpoint, not this file.
const CoerceSchema = z
  .enum(['toNumber', 'toNumberOrNull', 'toString', 'identity', 'toDateOnly', 'toIsoDateTime'])
  .describe(
    'Coercion applied to the resolved (or default) value, AFTER any $map — so ' +
      '{"$map": {"0001-01-01T00:00:00": null}, "coerce": "toDateOnly"} nulls a ' +
      'sentinel and formats every real date in one leaf. Date coercions truncate ' +
      'wall-clock calendar fields and never convert timezones (a trailing Z/offset ' +
      'is dropped, not applied, so the day cannot shift): "toDateOnly" yields ' +
      'YYYY-MM-DD, "toIsoDateTime" yields YYYY-MM-DDTHH:mm:ss (a date-only input ' +
      'is padded to midnight; fractional seconds are dropped). Both are null-safe: ' +
      'a null, absent, empty, or unparseable value yields null.',
  )

const MapScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

const DirectiveSchema: z.ZodType<MappingDirective> = z.lazy(() =>
  z
    .object({
      $from: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      default: z.unknown().optional(),
      $map: z.record(z.string(), MapScalarSchema).optional(),
      coerce: CoerceSchema.optional(),
      $each: MappingObjectSchema.optional(),
    })
    .strict(),
)

const MappingNodeSchema: z.ZodType<MappingNode> = z.lazy(() =>
  z.union([z.string().min(1), DirectiveSchema, MappingObjectSchema]),
)

// Nested-object keys may not start with "$" — that namespace is reserved for
// directives, so a typo'd directive fails loudly instead of being read as a
// field literally named "$from".
const MappingObjectSchema: z.ZodType<MappingObject> = z.lazy(() =>
  z.record(
    z.string().regex(/^[^$]/, 'mapping field names may not start with "$"'),
    MappingNodeSchema,
  ),
)

export const MappingTemplateSchema: z.ZodType<MappingTemplate> = MappingObjectSchema

// Stable identifier for the published mapping-format schema. Bumped on a format
// change consumers must notice — v2 added the `$map` value-translation directive
// (a directive `.strict()` means v1 validators reject a `$map`-using document);
// v3 adds the `toDateOnly` / `toIsoDateTime` coercions (sdk-feedback 0039), which
// a v2 validator's closed `coerce` enum rejects. Rejecting is the desired failure
// mode: a stale validator must not silently pass a document whose date format it
// cannot reproduce.
export const MAPPING_FORMAT_SCHEMA_ID =
  'https://pegasus.dolas.dev/schemas/integration-mapping/v3.json'

/** The published JSON Schema for the mapping format (the documented standard). */
export function mappingFormatJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(MappingTemplateSchema, { target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >
  return {
    $id: MAPPING_FORMAT_SCHEMA_ID,
    title: 'Pegasus Integration Mapping (output-shaped) v3',
    ...schema,
  }
}

// --- Compiler (template → engine TransformSpec) ----------------------------

function isDirective(node: MappingNode): node is MappingDirective {
  return typeof node === 'object' && node !== null && '$from' in node
}

function compileNode(node: MappingNode, to: string): FieldMapping[] {
  if (typeof node === 'string') return [{ to, from: [node] }]

  if (isDirective(node)) {
    const from = Array.isArray(node.$from) ? node.$from : [node.$from]
    if (node.$each) {
      return [{ to, from, default: node.default ?? [], each: compileObject(node.$each, '') }]
    }
    const fm: FieldMapping = { to, from }
    if ('default' in node) fm.default = node.default
    if (node.$map) fm.map = node.$map
    if (node.coerce) fm.coerce = node.coerce
    return [fm]
  }

  return compileObject(node, to)
}

function compileObject(obj: MappingObject, prefix: string): FieldMapping[] {
  const out: FieldMapping[] = []
  for (const [key, node] of Object.entries(obj)) {
    out.push(...compileNode(node, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

/** Compile a mapping document into the per-field spec the engine runs. */
export function compileMapping(template: MappingTemplate): TransformSpec {
  return compileObject(template, '')
}

// --- Target-path collection (for static checking) --------------------------

function walkTargets(obj: MappingObject, prefix: string, acc: string[]): void {
  for (const [key, node] of Object.entries(obj)) {
    const to = prefix ? `${prefix}.${key}` : key
    if (typeof node === 'string') acc.push(to)
    else if (isDirective(node)) {
      if (node.$each) walkTargets(node.$each, `${to}[]`, acc)
      else acc.push(to)
    } else walkTargets(node, to, acc)
  }
}

/** Every canonical leaf path the mapping produces (arrays marked with `[]`). */
export function collectTargetPaths(template: MappingTemplate): string[] {
  const acc: string[] = []
  walkTargets(template, '', acc)
  return acc
}

/** A `$map` value-translation directive located at a target leaf. */
export interface MapDirectiveAt {
  /** Canonical target path the `$map` writes to (arrays marked with `[]`). */
  to: string
  /** The translation table's output values (right-hand sides). */
  outputs: MapScalar[]
  /** True when `$map` is (invalidly) combined with `$each` — scalar-only violation. */
  withEach: boolean
}

/** Locate every `$map` directive in a mapping, with its target path and outputs. */
export function collectMapDirectives(template: MappingTemplate): MapDirectiveAt[] {
  const acc: MapDirectiveAt[] = []
  const visit = (obj: MappingObject, prefix: string): void => {
    for (const [key, node] of Object.entries(obj)) {
      const to = prefix ? `${prefix}.${key}` : key
      if (typeof node === 'string') continue
      if (isDirective(node)) {
        if (node.$map) {
          acc.push({ to, outputs: Object.values(node.$map), withEach: node.$each != null })
        }
        if (node.$each) visit(node.$each, `${to}[]`)
      } else {
        visit(node, to)
      }
    }
  }
  visit(template, '')
  return acc
}

/** Every source path the mapping reads (flattened `$from` chains, incl. `$each`). */
export function collectSourcePaths(template: MappingTemplate): string[] {
  const acc: string[] = []
  const visit = (obj: MappingObject): void => {
    for (const node of Object.values(obj)) {
      if (typeof node === 'string') acc.push(node)
      else if (isDirective(node)) {
        const from = Array.isArray(node.$from) ? node.$from : [node.$from]
        acc.push(...from)
        if (node.$each) visit(node.$each)
      } else visit(node)
    }
  }
  visit(template)
  return acc
}

/**
 * Top-level source-field roots (the first path segment of every `$from` that
 * resolves against the order itself — NOT descending into `$each`, whose paths
 * resolve against array elements). Used by the static checker's input-side guard.
 */
export function collectTopLevelSourceRoots(template: MappingTemplate): string[] {
  const roots = new Set<string>()
  const add = (path: string): void => {
    // First segment, minus any `[idx]` suffix. "." (root identity) has no root field.
    const root = path.split('.')[0]!.replace(/\[\d+\]/g, '')
    if (root) roots.add(root)
  }
  const visit = (obj: MappingObject): void => {
    for (const node of Object.values(obj)) {
      if (typeof node === 'string') add(node)
      else if (isDirective(node)) {
        const from = Array.isArray(node.$from) ? node.$from : [node.$from]
        from.forEach(add)
        // Intentionally do NOT descend into $each — element scope, not order scope.
      } else visit(node)
    }
  }
  visit(template)
  return [...roots]
}

/**
 * Full order-scope source paths — every `$from` that resolves against the order
 * itself (NOT descending into `$each`, whose paths resolve against array
 * elements), kept at FULL dotted depth rather than collapsed to their first
 * segment. This is the sibling of `collectTopLevelSourceRoots`; the static
 * checker's input-side guard uses it so a floor can open a specific vetted
 * sub-path (e.g. `UnusedFields.survey_received`) while leaving the rest of an
 * otherwise-closed root shut. The `.` root-identity read (whole order) carries no
 * field path and is omitted.
 */
export function collectTopLevelSourcePaths(template: MappingTemplate): string[] {
  const paths = new Set<string>()
  const add = (path: string): void => {
    // Skip the `.` root-identity read (no field) and any empty-root path.
    if (path.split('.')[0]!.replace(/\[\d+\]/g, '')) paths.add(path)
  }
  const visit = (obj: MappingObject): void => {
    for (const node of Object.values(obj)) {
      if (typeof node === 'string') add(node)
      else if (isDirective(node)) {
        const from = Array.isArray(node.$from) ? node.$from : [node.$from]
        from.forEach(add)
        // Intentionally do NOT descend into $each — element scope, not order scope.
      } else visit(node)
    }
  }
  visit(template)
  return [...paths]
}
