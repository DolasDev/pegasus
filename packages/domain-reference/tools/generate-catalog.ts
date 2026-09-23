/**
 * The catalog generator — [catalog §4].
 *
 * It emits the published event catalog from the executable specification: two JSON Schema
 * documents (one per face, [catalog §4.1]), a machine-readable manifest, and a README that points
 * at both. `tests/conformance/catalog-staleness.test.ts` fails when what is committed and what this
 * produces disagree.
 *
 * ## Why it is generated
 *
 * The same reason the glossary is ([SD §1.1] on the `correlation` bag): **two homes for one fact
 * can drift.** A hand-written schema is a second declaration of a record shape whose first
 * declaration is the type, and nothing would hold them together. So no schema here is written by
 * hand — every one of them is the TypeScript type, resolved by the compiler and rendered.
 *
 * ## How it reads the types
 *
 * The **compiler API**, and specifically the *checker*, not the syntax. The published record types
 * are distributive conditionals over intersections (`Assertion` fans out over every type, five
 * bases and both faces; an act's `value` fans out again on `outcome`), and reading their
 * declarations syntactically would mean re-implementing the type system. `getTypeAtLocation` on a
 * probe alias does that work instead, and hands back a plain union of object types to walk.
 *
 * The probe is a **virtual source file**: it never touches the working tree, so a crashed run
 * leaves nothing behind and no other tool ever sees it.
 *
 * ## What it does not attempt
 *
 * Cross-field rules that JSON Schema cannot state — "the envelope `subject` MUST equal
 * `factRef.subject`" ([SD §1.3] item 4), A8-INSTANT, the capture rules M1-M7 — are carried as
 * `x-rule` annotations naming the decision, never silently dropped and never half-expressed.
 *
 * ## Prettier
 *
 * The pre-commit hook runs `prettier --write` over `.json` and `.md`, so an emitted file that is
 * not already a prettier fixed point produces a green generator run and a commit that no longer
 * matches it. `JSON.stringify` is *not* a fixed point — prettier collapses short arrays onto one
 * line — so the generator formats its own output with prettier and emits those bytes.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'
import ts from 'typescript'

import { byteOrder, collectOwedInventory } from './generate-glossary.ts'

/* ------------------------------------------------------------------------------------------------
 * Where things are
 * ---------------------------------------------------------------------------------------------- */

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const SRC_DIR = `${PACKAGE_DIR}src/`
const CATALOG_DIR = fileURLToPath(
  new URL('../../../docs/domain-reference/catalog/', import.meta.url),
)

/** The committed artifacts, and the command that rewrites them. Both appear in every output. */
export const CATALOG_REPO_DIR = 'docs/domain-reference/catalog'
export const CATALOG_GENERATOR_REPO_PATH = 'packages/domain-reference/tools/generate-catalog.ts'
export const CATALOG_COMMAND = 'npm run catalog -w @pegasus/domain-reference'
export const CATALOG_DECISION_REPO_PATH =
  'docs/domain-reference/analysis/published-event-catalog.md'

/** The file name each emitted artifact is committed under, relative to {@link CATALOG_REPO_DIR}. */
export const CATALOG_FILES = {
  captured: 'captured.schema.json',
  queried: 'queried.schema.json',
  index: 'index.json',
  readme: 'README.md',
} as const

const DO_NOT_EDIT = 'GENERATED FILE — DO NOT EDIT BY HAND'

/* ------------------------------------------------------------------------------------------------
 * JSON, and a stable rendering of it
 * ---------------------------------------------------------------------------------------------- */

export type Json = null | boolean | number | string | readonly Json[] | { [key: string]: Json }

/**
 * Key-sorted, so two structurally equal schemas produce the same string and can be deduplicated
 * into one `$defs` entry. Byte order, never locale — the same rule the glossary states, and for the
 * same reason: a generated file that reorders itself on another machine turns its gate into noise.
 */
function stableJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, Json>).sort(([left], [right]) =>
    byteOrder(left, right),
  )
  const rendered = entries.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`)
  return `{${rendered.join(',')}}`
}

/* ------------------------------------------------------------------------------------------------
 * The program, with a virtual probe
 * ---------------------------------------------------------------------------------------------- */

const PROBE_PATH = `${SRC_DIR}__catalog-probe.ts`

/** The published tables the manifest quotes. Read through the checker, never re-typed here. */
const DECLARATIONS = [
  'CATALOG_VERSION',
  'CATALOG_FACES',
  'ACT_TYPES',
  'NON_ACT_TYPES',
  'META_RECORD_TYPES',
  'CATALOG_MEMBERS',
  'FILTER_AXES',
  'FILTER_AXIS_SOURCE',
  'FILTER_AXIS_FACES',
  'REFUSED_FILTER_AXES',
  'ADDITIVE_CHANGES',
  'BREAKING_CHANGES',
  'CANONICAL_SUBJECT_FAMILY',
  'FACT_CLASS_FAMILY',
  'SUBJECT_FAMILIES',
] as const

type DeclarationName = (typeof DECLARATIONS)[number]

/**
 * The three types every published record resolves through.
 *
 * `Assertion` with its default parameter is *already* the union of every published assertion type,
 * across all five bases and both faces, because `CapturedAssertion<T>` and `QueriedAssertion<T>`
 * are distributive conditionals. So the probe names three types rather than thirty-three, and each
 * resolved variant is bucketed afterwards by the literal value of its own `type` field — the single
 * classification axis ([SD §1.3]), and therefore the only honest thing to bucket on.
 *
 * `Correction` resolves through **`RecordedCorrection`** — [catalog §1.4]: the published form is
 * the recorded one, because [SD §6.2] requires a correction to name the instrument that authorised
 * it and [SD §6.5] the obligations it emits.
 */
const RECORD_PROBES = ['Assertion', 'FactResolved', 'RecordedCorrection'] as const

/**
 * The probe source.
 *
 * `typeof spec.X` puts every published table into the type system, so the manifest is read through
 * the checker rather than by importing `src/` at runtime. It cannot be imported at runtime: `src/`
 * spells its own imports without file extensions, which the bundler resolution this package
 * compiles under allows and Node's loader does not.
 */
const PROBE_SOURCE = [
  "import type { Assertion, FactResolved } from './assertions'",
  "import type { RecordedCorrection } from './rules/corrections'",
  "import type * as spec from './index'",
  '',
  ...RECORD_PROBES.map((name) => `export type Record_${name} = ${name}`),
  ...DECLARATIONS.map((name) => `export type Decl_${name} = typeof spec.${name}`),
  '',
].join('\n')

interface Model {
  readonly checker: ts.TypeChecker
  readonly probeFile: ts.SourceFile
}

function buildModel(): Model {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
  }

  // A virtual file, so nothing is ever written into `src/`. A generator that dropped a scratch
  // module into the package would leave one behind the first time it threw.
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => (name === PROBE_PATH ? PROBE_SOURCE : readFile(name))
  host.fileExists = (name) => name === PROBE_PATH || fileExists(name)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === PROBE_PATH
      ? ts.createSourceFile(name, PROBE_SOURCE, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(name, languageVersion, onError, shouldCreate)

  const program = ts.createProgram([PROBE_PATH], options, host)
  const probeFile = program.getSourceFile(PROBE_PATH)
  if (probeFile === undefined) throw new Error('the catalog generator could not compile its probe')

  const failures = program
    .getSemanticDiagnostics(probeFile)
    .concat(program.getSyntacticDiagnostics(probeFile))
  const first = failures[0]
  if (first !== undefined) {
    throw new Error(
      `the catalog probe does not typecheck (${failures.length}): ` +
        ts.flattenDiagnosticMessageText(first.messageText, ' '),
    )
  }

  return { checker: program.getTypeChecker(), probeFile }
}

/** The resolved type of one probe alias. Throws rather than returning a silent `undefined`. */
function aliasType(model: Model, alias: string): ts.Type {
  const statement = model.probeFile.statements.find(
    (candidate): candidate is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(candidate) && candidate.name.text === alias,
  )
  if (statement === undefined) throw new Error(`the catalog probe lost its alias \`${alias}\``)
  return model.checker.getTypeAtLocation(statement.name)
}

/* ------------------------------------------------------------------------------------------------
 * Reading the published declarations through the checker
 * ---------------------------------------------------------------------------------------------- */

function literalOf(type: ts.Type, what: string): string {
  if (!type.isStringLiteral()) {
    throw new Error(`${what} is not a string literal — \`as const\` may have been dropped`)
  }
  return type.value
}

function tupleOf(model: Model, type: ts.Type, what: string): string[] {
  if (!model.checker.isTupleType(type)) {
    throw new Error(`${what} is not a readonly tuple — \`as const\` may have been dropped`)
  }
  return model.checker
    .getTypeArguments(type as ts.TypeReference)
    .map((member, index) => literalOf(member, `${what}[${index}]`))
}

function propertiesOf(model: Model, type: ts.Type): [string, ts.Type][] {
  return model.checker
    .getPropertiesOfType(type)
    .map(
      (symbol) =>
        [symbol.name, model.checker.getTypeOfSymbolAtLocation(symbol, model.probeFile)] as [
          string,
          ts.Type,
        ],
    )
}

function recordOfStrings(model: Model, type: ts.Type, what: string): Record<string, string> {
  const table: Record<string, string> = {}
  for (const [key, value] of propertiesOf(model, type)) {
    table[key] = literalOf(value, `${what}.${key}`)
  }
  return table
}

function recordOfTuples(model: Model, type: ts.Type, what: string): Record<string, string[]> {
  const table: Record<string, string[]> = {}
  for (const [key, value] of propertiesOf(model, type)) {
    table[key] = tupleOf(model, value, `${what}.${key}`)
  }
  return table
}

interface Declarations {
  readonly version: string
  readonly members: readonly string[]
  readonly actTypes: readonly string[]
  readonly nonActTypes: readonly string[]
  readonly metaTypes: readonly string[]
  readonly faces: readonly string[]
  readonly filterAxes: readonly string[]
  readonly filterAxisSource: Readonly<Record<string, string>>
  readonly filterAxisFaces: Readonly<Record<string, readonly string[]>>
  readonly refusedFilterAxes: readonly string[]
  readonly additiveChanges: readonly string[]
  readonly breakingChanges: readonly string[]
  readonly canonicalSubjectFamily: Readonly<Record<string, string>>
  readonly factClassFamily: Readonly<Record<string, string>>
  readonly subjectFamilies: Readonly<Record<string, readonly string[]>>
}

function readDeclarations(model: Model): Declarations {
  const declared = (name: DeclarationName): ts.Type => aliasType(model, `Decl_${name}`)
  return {
    version: literalOf(declared('CATALOG_VERSION'), 'CATALOG_VERSION'),
    members: tupleOf(model, declared('CATALOG_MEMBERS'), 'CATALOG_MEMBERS'),
    actTypes: tupleOf(model, declared('ACT_TYPES'), 'ACT_TYPES'),
    nonActTypes: tupleOf(model, declared('NON_ACT_TYPES'), 'NON_ACT_TYPES'),
    metaTypes: tupleOf(model, declared('META_RECORD_TYPES'), 'META_RECORD_TYPES'),
    faces: tupleOf(model, declared('CATALOG_FACES'), 'CATALOG_FACES'),
    filterAxes: tupleOf(model, declared('FILTER_AXES'), 'FILTER_AXES'),
    filterAxisSource: recordOfStrings(model, declared('FILTER_AXIS_SOURCE'), 'FILTER_AXIS_SOURCE'),
    filterAxisFaces: recordOfTuples(model, declared('FILTER_AXIS_FACES'), 'FILTER_AXIS_FACES'),
    refusedFilterAxes: tupleOf(model, declared('REFUSED_FILTER_AXES'), 'REFUSED_FILTER_AXES'),
    additiveChanges: tupleOf(model, declared('ADDITIVE_CHANGES'), 'ADDITIVE_CHANGES'),
    breakingChanges: tupleOf(model, declared('BREAKING_CHANGES'), 'BREAKING_CHANGES'),
    canonicalSubjectFamily: recordOfStrings(
      model,
      declared('CANONICAL_SUBJECT_FAMILY'),
      'CANONICAL_SUBJECT_FAMILY',
    ),
    factClassFamily: recordOfStrings(model, declared('FACT_CLASS_FAMILY'), 'FACT_CLASS_FAMILY'),
    subjectFamilies: recordOfTuples(model, declared('SUBJECT_FAMILIES'), 'SUBJECT_FAMILIES'),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Types to JSON Schema
 * ---------------------------------------------------------------------------------------------- */

interface Context {
  readonly checker: ts.TypeChecker
  readonly at: ts.Node
  /** `$defs`, keyed by the name each shared shape is published under. */
  readonly defs: Map<string, Json>
  /** `name + shape` → the `$defs` name already assigned to it. */
  readonly assigned: Map<string, string>
  /** The types on the current path, so a cycle is a loud failure rather than a hang. */
  readonly path: ts.Type[]
  /** [SD §4.7.1]'s canonical subject families, so a recognised union can be named by its family. */
  readonly families: Readonly<Record<string, readonly string[]>>
}

/**
 * The brand tag on `Brand<string, Tag>`, or `undefined` if this is not a branded type.
 *
 * Brands are intersections of a primitive with a phantom `__brand` property, which is the one
 * TypeScript idiom a naive walker turns into garbage: `getPropertiesOfType` on `string & {…}`
 * reports every method of `String`. So they are recognised structurally and rendered as the
 * primitive they carry, with the tag kept as an annotation.
 */
function brandTagOf(type: ts.Type, context: Context): string | undefined {
  if ((type.flags & ts.TypeFlags.Intersection) === 0) return undefined
  const parts = (type as ts.IntersectionType).types
  if (!parts.some((part) => (part.flags & ts.TypeFlags.StringLike) !== 0)) return undefined
  for (const part of parts) {
    const brand = part.getProperty('__brand')
    if (brand === undefined) continue
    const tag = context.checker.getTypeOfSymbolAtLocation(brand, context.at)
    if (tag.isStringLiteral()) return tag.value
  }
  return undefined
}

/**
 * A branded string, rendered — [SD §7] for the identifier shape, [SD §4.2] for the clocks.
 *
 * `Instant` and `CalendarDate` carry a JSON Schema `format`, because both have a lexical rule the
 * code states (`instant()` parses a date-time; `calendarDate()` requires `YYYY-MM-DD`). Every other
 * brand is a string whose tag is published as an annotation rather than as a pattern the types do
 * not state.
 */
function brandedString(tag: string): Json {
  const schema: Record<string, Json> = { type: 'string', 'x-brand': tag }
  if (tag === 'Instant') schema['format'] = 'date-time'
  if (tag === 'CalendarDate') schema['format'] = 'date'
  if (tag.startsWith('id:')) schema['x-aggregate'] = tag.slice('id:'.length)
  if (tag.startsWith('owedCode:')) {
    schema['x-owed-vocabulary'] = tag.slice('owedCode:'.length)
    schema['x-owed'] =
      'the code list is owed; the shape is published and the members are not ([SD §0])'
  }
  return schema
}

/** `undefined` members of a union are the optionality marker, never a value the catalog carries. */
function isAbsent(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
}

/** A property typed `never` (or `?: never`) is a **forbidden** field, not a missing one. */
function isForbidden(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Never) !== 0 || isAbsent(type)
}

/**
 * The name this type should be published under in `$defs`, if it deserves one.
 *
 * Arrays are deliberately excluded. `ReadonlyArray` and `NonEmptyArray` are the *containers*, not
 * the shapes worth naming: hoisting them produces `ReadonlyArray2`…`ReadonlyArray5`, five entries
 * that say nothing about what is in them, while the element type they wrap is hoisted on its own
 * merits anyway.
 */
function nameOf(type: ts.Type, context: Context): string | undefined {
  if (context.checker.isArrayType(type) || context.checker.isTupleType(type)) return undefined
  const alias = type.aliasSymbol?.name
  if (alias !== undefined && alias !== '__type') return alias
  const symbol = type.getSymbol()?.name
  if (symbol !== undefined && symbol !== '__type' && symbol !== '__object') return symbol
  return undefined
}

/**
 * A `$defs` name that says which instantiation it is.
 *
 * One generic reaches this function once per instantiation, and the numeric fallback below would
 * spell fourteen aggregate id types `AggregateId`…`AggregateId14` — names that identify nothing. So
 * two shapes carry a better discriminator in the body itself and it is used: a brand carries its
 * tag, and an `Owed<Name, Owner>` carries the name of what is owed.
 */
function refineName(name: string, body: Json): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return name
  const fields = body as Record<string, Json>

  const tag = fields['x-brand']
  if (typeof tag === 'string') {
    if (name === 'Brand') return tag
    const colon = tag.indexOf(':')
    return colon < 0 ? name : `${name}.${tag.slice(colon + 1)}`
  }

  const properties = fields['properties']
  if (name === 'Owed' && properties !== null && typeof properties === 'object') {
    const owed = (properties as Record<string, Json>)['owed']
    if (owed !== null && typeof owed === 'object' && !Array.isArray(owed)) {
      const what = (owed as Record<string, Json>)['const']
      if (typeof what === 'string') return `${name}.${what}`
    }
  }

  return name
}

function asObject(value: Json | undefined): Record<string, Json> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : undefined
}

const SUBJECT_REF_PREFIX = '#/$defs/SubjectRef.'

/**
 * The aggregate kind this schema is a `SubjectRef` to, or `undefined` if it is not one.
 *
 * It answers for a rendered object *and* for a `$ref` to one already hoisted, because a union is
 * recognised after its members have been converted — by which point each member is a reference,
 * not the object it points at.
 */
function subjectRefKind(value: Json): string | undefined {
  const object = asObject(value)
  if (object === undefined) return undefined

  const reference = object['$ref']
  if (typeof reference === 'string') {
    if (!reference.startsWith(SUBJECT_REF_PREFIX)) return undefined
    const kind = reference.slice(SUBJECT_REF_PREFIX.length)
    // `SubjectRef.family.<f>` is a family, not a kind, and must not be folded back into one.
    return kind.includes('.') ? undefined : kind
  }

  if (object['type'] !== 'object') return undefined
  const properties = asObject(object['properties'])
  if (properties === undefined) return undefined
  const keys = Object.keys(properties).sort(byteOrder)
  if (keys.length !== 2 || keys[0] !== 'aggregate' || keys[1] !== 'id') return undefined
  const aggregate = asObject(properties['aggregate'])?.['const']
  const id = asObject(properties['id'])?.['$ref']
  return typeof aggregate === 'string' && typeof id === 'string' ? aggregate : undefined
}

/**
 * A name for a shape the compiler could not give us one for — today, exactly one shape.
 *
 * `SubjectRef<K>` is a **distributive conditional** ([SD §1.2]), and instantiating it loses the
 * alias: `subject` and `context[]` both resolve to a bare union of `{aggregate, id}` objects with
 * no `aliasSymbol` to hoist on. Left alone that inlines the fourteen-member envelope union into
 * every variant of every record, which is most of the document.
 *
 * So it is recognised by shape and named by the **canonical subject family** it matches
 * ([SD §4.7] note 2) — `SubjectRef.goods`, `SubjectRef.stop`, `SubjectRef.anyAggregate`. The name a
 * reader sees is then the declaration that licensed the union, not a serial number.
 */
function structuralName(body: Json, context: Context): string | undefined {
  const single = subjectRefKind(body)
  const union = asObject(body)?.['anyOf']
  const kinds =
    single !== undefined ? [single] : Array.isArray(union) ? union.map(subjectRefKind) : undefined
  if (kinds === undefined || kinds.length === 0) return undefined
  if (kinds.some((kind) => kind === undefined)) return undefined

  const members = (kinds as string[]).slice().sort(byteOrder)
  if (members.length === 1) return `SubjectRef.${members[0]}`

  // A family name only where a family is what this is. `SubjectRef.stop` is a reference to the
  // `stop` **kind**; `SubjectRef.family.stop` is the `stop` **family**, which [SD §8.2] declares as
  // `{stop, externallyPerformedLeg}`. Spelling both the same way would hide exactly the distinction
  // E-CANON turns on.
  const spelled = stableJson(members)
  for (const family of Object.keys(context.families).sort(byteOrder)) {
    const declared = (context.families[family] ?? []).slice().sort(byteOrder)
    if (stableJson(declared) === spelled) return `SubjectRef.family.${family}`
  }
  return `SubjectRef.${members.join('+')}`
}

function objectSchema(type: ts.Type, context: Context): Json {
  const properties: Record<string, Json> = {}
  const required: string[] = []

  const symbols = context.checker
    .getPropertiesOfType(type)
    .slice()
    // Byte order, so the emitted key order is a function of the names and nothing else.
    .sort((left, right) => byteOrder(left.name, right.name))

  for (const symbol of symbols) {
    const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0
    const declared = context.checker.getTypeOfSymbolAtLocation(symbol, context.at)

    if (isForbidden(declared)) {
      // `"field": false` — [SD §1.1]'s permanently-forbidden list, made mechanical. A schema that
      // simply omitted them would forbid them only by way of `additionalProperties`, which says
      // nothing about *which* fields were refused.
      properties[symbol.name] = false
      continue
    }

    // No surgery on the type here: `convert`'s union branch already drops the `undefined` member
    // that optionality adds, and it does so without reaching for `checker.getUnionType`, which is
    // internal API — it exists at runtime and is absent from the public `TypeChecker`, so a
    // generator built on it typechecks nowhere and breaks on a compiler upgrade with no warning.
    properties[symbol.name] = schemaOf(declared, context)
    if (!optional) required.push(symbol.name)
  }

  const schema: Record<string, Json> = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required.sort(byteOrder)
  // Closed, per [catalog §2.3]: a record minted under a later `specVersion` is expected to fail an
  // earlier version's schema, which is why the version rides on the record.
  schema['additionalProperties'] = false
  return schema
}

function arraySchema(type: ts.Type, context: Context): Json | undefined {
  const checker = context.checker

  if (checker.isTupleType(type)) {
    // `NonEmptyArray<T>` is `readonly [T, ...T[]]`, which is the only tuple shape the vocabulary
    // carries: one required element and a rest of the same type.
    const args = checker.getTypeArguments(type as ts.TypeReference)
    const first = args[0]
    if (first === undefined) return { type: 'array', maxItems: 0 }
    return { type: 'array', items: schemaOf(first, context), minItems: 1 }
  }

  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0]
    return { type: 'array', items: element === undefined ? true : schemaOf(element, context) }
  }

  return undefined
}

/** The schema for one resolved type. Hoists anything the compiler gave a name into `$defs`. */
function schemaOf(type: ts.Type, context: Context): Json {
  if (context.path.includes(type)) {
    throw new Error(
      `the catalog generator met a recursive type (${context.checker.typeToString(type)}). ` +
        'Recursion is expressible in JSON Schema but nothing in the vocabulary needs it, so this ' +
        'is reported rather than silently rendered as a permissive schema.',
    )
  }

  const declared = nameOf(type, context)
  context.path.push(type)
  let body: Json
  try {
    body = convert(type, context)
  } finally {
    context.path.pop()
  }

  // The structural name wins where there is one: an alias survives instantiation in some positions
  // and not others, so preferring it would spell one shape `SubjectRef` here and
  // `SubjectRef.family.goods` there, and publish both.
  // A body that is already nothing but a reference gets no `$defs` entry of its own: hoisting it
  // would publish `SubjectRef.stop2` whose whole content is a pointer at `SubjectRef.stop`.
  const keys = asObject(body)
  if (keys !== undefined && Object.keys(keys).length === 1 && '$ref' in keys) return body

  const named = structuralName(body, context) ?? declared
  if (named === undefined) return body
  const name = refineName(named, body)

  const key = `${name} ${stableJson(body)}`
  const already = context.assigned.get(key)
  if (already !== undefined) return { $ref: `#/$defs/${already}` }

  // Two different instantiations of one generic — `SubjectRef` over the `goods` family and over the
  // `stop` family — are two shapes under one name, so the second one takes a numbered spelling.
  let published = name
  for (let n = 2; context.defs.has(published); n += 1) published = `${name}${n}`
  context.assigned.set(key, published)
  context.defs.set(published, body)
  return { $ref: `#/$defs/${published}` }
}

function convert(type: ts.Type, context: Context): Json {
  const checker = context.checker
  const flags = type.flags

  if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true
  if ((flags & ts.TypeFlags.Never) !== 0) return false
  if ((flags & ts.TypeFlags.Null) !== 0) return { type: 'null' }
  if (isAbsent(type)) return { type: 'null' }

  if (type.isStringLiteral()) return { const: type.value }
  if (type.isNumberLiteral()) return { const: type.value }
  if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return { const: checker.typeToString(type) === 'true' }
  }

  const brand = brandTagOf(type, context)
  if (brand !== undefined) return brandedString(brand)

  if ((flags & ts.TypeFlags.String) !== 0) return { type: 'string' }
  if ((flags & ts.TypeFlags.Number) !== 0) return { type: 'number' }
  if ((flags & ts.TypeFlags.Boolean) !== 0) return { type: 'boolean' }

  if (type.isUnion()) {
    const members = type.types.filter((member) => !isAbsent(member))
    const first = members[0]
    if (members.length === 1 && first !== undefined) return schemaOf(first, context)
    if (members.every((member) => member.isStringLiteral())) {
      return { enum: members.map((member) => (member as ts.StringLiteralType).value) }
    }
    // `anyOf`, never `oneOf`. A TypeScript union is satisfied by being assignable to **at least
    // one** member, and its members are not always disjoint, so `oneOf` would reject records the
    // types admit. The worked example used to be `Reason`, whose two branches overlapped on a code
    // of `OTHER` carrying a remark while `ReasonCode` was a branded string; A4 published the
    // vocabulary as a closed enum that excludes `OTHER`, which made those two branches disjoint.
    // The rule does not depend on that example — it is a property of TypeScript unions, and
    // switching to `oneOf` on the strength of one union having become disjoint would be a
    // correctness bug waiting for the next overlapping one.
    return { anyOf: dedupe(members.map((member) => schemaOf(member, context))) }
  }

  const array = arraySchema(type, context)
  if (array !== undefined) return array

  if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0) {
    return objectSchema(type, context)
  }

  throw new Error(
    `the catalog generator has no rendering for \`${checker.typeToString(type)}\`. ` +
      'Add one here rather than letting it fall through to a permissive schema.',
  )
}

/** Structurally identical branches collapse: two spellings of one shape are one shape. */
function dedupe(branches: readonly Json[]): Json[] {
  const seen = new Set<string>()
  const kept: Json[] = []
  for (const branch of branches) {
    const key = stableJson(branch)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(branch)
  }
  return kept
}

/* ------------------------------------------------------------------------------------------------
 * The two schema bundles
 * ---------------------------------------------------------------------------------------------- */

type Face = 'captured' | 'queried'

const FACES: readonly Face[] = ['captured', 'queried']

/**
 * Which face a resolved record variant belongs to.
 *
 * [SD §1.1] makes `recordedAt` "server-authored; FORBIDDEN on capture, MANDATORY on query", so the
 * field is the discriminator and no type-level surgery is needed to split the union: a variant
 * whose `recordedAt` is `never` is a captured record, and one that carries an instant is a queried
 * one.
 */
function faceOf(variant: ts.Type, context: Context): Face {
  const property = variant.getProperty('recordedAt')
  if (property === undefined) {
    throw new Error(
      'a published record variant declares no `recordedAt`, so its face cannot be decided. ' +
        '[SD §1.1] requires the field on both faces — forbidden on one, mandatory on the other.',
    )
  }
  const declared = context.checker.getTypeOfSymbolAtLocation(property, context.at)
  return isForbidden(declared) ? 'captured' : 'queried'
}

/** The `type` a variant carries — the single classification axis, read off the record itself. */
function memberOf(variant: ts.Type, context: Context): string {
  const property = variant.getProperty('type')
  if (property === undefined) throw new Error('a published record variant carries no `type`')
  const declared = context.checker.getTypeOfSymbolAtLocation(property, context.at)
  if (!declared.isStringLiteral()) {
    throw new Error(
      `a published record variant's \`type\` is \`${context.checker.typeToString(declared)}\`, ` +
        'not a literal. [SD §1.3] E-TYPE requires exactly one member of the vocabulary.',
    )
  }
  return declared.value
}

/** The per-member `x-rule` notes: what the record obeys that JSON Schema cannot say. */
const CROSS_FIELD_RULES: Readonly<Record<string, readonly string[]>> = {
  FactResolved: [
    '[SD §1.3] item 4 — the envelope `subject` MUST equal `factRef.subject`. A cross-field equality ' +
      'JSON Schema cannot state; `factResolvedSubjectMatches()` in `src/assertions.ts` is the check.',
    '[SD §4.3] — append-only. A later resolution of the same key does not replace an earlier one, ' +
      'so "the history of which answer we were giving when" survives.',
  ],
  Correction: [
    '[SD §1.3] item 4 — the envelope `subject` MUST equal the subject of the corrected record.',
    '[SD §6.3] — financial facts are corrected only by an offsetting record, never by retraction, ' +
      'which is why no correction may name a `charge`; `CorrectableType` in ' +
      '`src/rules/corrections.ts` excludes it in the type.',
  ],
}

/** The rules every record obeys, published once on the bundle rather than 33 times inside it. */
const BUNDLE_RULES: readonly string[] = [
  '[SD §1.3] E-TYPE — a record carrying no `type`, a `type` outside the vocabulary for its ' +
    '`specVersion`, or any second classification alongside it, is rejected at the boundary.',
  '[SD §4.6] E-CANON-STRICT — a record whose `subject` kind is outside its type’s canonical ' +
    'family is rejected at the boundary, not re-keyed, and the boundary never substitutes a ' +
    'subject the record did not name.',
  '[SD §5.2] M1-M7 — capture eligibility is per `type` and binds on `capturedBy`. M1: ' +
    '`ASSUMED_FROM_PLAN` may never carry `basis = ACTUAL`. M3: every outcome other than ' +
    '`COMPLETED`, and every reason, needs a human or partner asserter. `src/rules/capture.ts` is ' +
    'the executable form; none of it is expressible in a schema.',
  '[A8] A8-INSTANT — authority is evaluated at the instant the fact is about, not at the instant ' +
    'the record is read.',
  '[SD §1.4] — `context[]` is non-authoritative, carries no value, and is never the resolution key.',
]

interface Bundle {
  readonly face: Face
  readonly document: Json
}

function bundlesFor(model: Model, declarations: Declarations): readonly Bundle[] {
  const context: Context = {
    checker: model.checker,
    at: model.probeFile,
    defs: new Map(),
    assigned: new Map(),
    path: [],
    families: declarations.subjectFamilies,
  }

  const collected: Record<Face, Map<string, Json[]>> = {
    captured: new Map(),
    queried: new Map(),
  }

  for (const probe of RECORD_PROBES) {
    const resolved = aliasType(model, `Record_${probe}`)
    const variants = resolved.isUnion() ? resolved.types : [resolved]
    for (const variant of variants) {
      const member = memberOf(variant, context)
      const face = faceOf(variant, context)
      const branches = collected[face].get(member) ?? []
      branches.push(schemaOf(variant, context))
      collected[face].set(member, branches)
    }
  }

  const expected = [...declarations.members].sort(byteOrder)
  for (const face of FACES) {
    const found = [...collected[face].keys()].sort(byteOrder)
    if (stableJson(found) !== stableJson(expected)) {
      throw new Error(
        `the ${face} face resolved ${found.length} members and the vocabulary declares ` +
          `${expected.length}. Missing: ${expected.filter((m) => !found.includes(m)).join(', ') || '—'}. ` +
          `Unexpected: ${found.filter((m) => !expected.includes(m)).join(', ') || '—'}.`,
      )
    }
  }

  const defs: Record<string, Json> = {}
  for (const name of [...context.defs.keys()].sort(byteOrder)) {
    const body = context.defs.get(name)
    if (body !== undefined) defs[name] = body
  }

  return FACES.map((face) => {
    const records: Record<string, Json> = {}
    for (const member of expected) {
      const branches = dedupe(collected[face].get(member) ?? [])
      const only = branches[0]
      const schema: Record<string, Json> =
        branches.length === 1 && only !== null && typeof only === 'object' && !Array.isArray(only)
          ? { ...(only as Record<string, Json>) }
          : { anyOf: branches }
      schema['title'] = member
      const rules = CROSS_FIELD_RULES[member]
      if (rules !== undefined) schema['x-rule'] = rules
      records[`record.${member}`] = schema
    }
    return {
      face,
      document: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `https://pegasus.invalid/domain-reference/catalog/${declarations.version}/${face}.schema.json`,
        title: `Household-goods moving & storage reference catalog — ${face} face`,
        description:
          face === 'captured'
            ? 'What anything asserting into the catalog must satisfy. `recordedAt` is ' +
              'server-authored and FORBIDDEN here ([SD §1.1]).'
            : 'What anything reading out of the catalog is served. `recordedAt` is MANDATORY here ' +
              '([SD §1.1]).',
        'x-generated': DO_NOT_EDIT,
        'x-generator': CATALOG_GENERATOR_REPO_PATH,
        'x-command': CATALOG_COMMAND,
        'x-decided-by': CATALOG_DECISION_REPO_PATH,
        'x-spec-version': declarations.version,
        'x-face': face,
        'x-rule': BUNDLE_RULES,
        anyOf: expected.map((member) => ({ $ref: `#/$defs/record.${member}` })),
        $defs: { ...records, ...defs },
      },
    }
  })
}

/* ------------------------------------------------------------------------------------------------
 * The manifest
 * ---------------------------------------------------------------------------------------------- */

function indexDocument(declarations: Declarations): Json {
  const owed = collectOwedInventory()
  const table = JSON.parse(readFileSync(`${PACKAGE_DIR}data/canonical-subjects.json`, 'utf8')) as {
    rows: { type: string; qualifier: { fields: string[] } | null }[]
  }
  const qualifiers = new Map(table.rows.map((row) => [row.type, row.qualifier?.fields ?? null]))

  return {
    'x-generated': DO_NOT_EDIT,
    'x-generator': CATALOG_GENERATOR_REPO_PATH,
    'x-command': CATALOG_COMMAND,
    catalog: {
      specVersion: declarations.version,
      decidedBy: CATALOG_DECISION_REPO_PATH,
      note:
        'The published catalog is the record vocabulary, exactly — [catalog §1]. There is no ' +
        'coarser published layer over these members, because a second classification axis is ' +
        'permanently forbidden by [SD §1.1].',
      memberCount: declarations.members.length,
      faces: [...declarations.faces],
      schemas: { captured: CATALOG_FILES.captured, queried: CATALOG_FILES.queried },
    },
    members: [...declarations.members].sort(byteOrder).map((member) => {
      const record: Record<string, Json> = {
        type: member,
        kind: declarations.metaTypes.includes(member)
          ? 'meta'
          : declarations.actTypes.includes(member)
            ? 'act'
            : 'assertion',
      }
      const family = declarations.canonicalSubjectFamily[member]
      if (family !== undefined) {
        record['canonicalSubjectFamily'] = family
        record['subjectKinds'] = [...(declarations.subjectFamilies[family] ?? [])]
      }
      const factClass = declarations.factClassFamily[member]
      if (factClass !== undefined) record['factClassFamily'] = factClass
      const qualifier = qualifiers.get(member)
      if (qualifier !== undefined) record['qualifier'] = qualifier === null ? null : [...qualifier]
      return record
    }),
    filtering: {
      note:
        'The filter vocabulary is the envelope plus the keys derived from it, and nothing else — ' +
        '[catalog §3.2]. One vocabulary serves both delivery modes (`src:dcsa`), with AND between ' +
        'filters and OR within a comma-separated list.',
      axes: declarations.filterAxes.map((axis) => ({
        axis,
        source: declarations.filterAxisSource[axis] ?? 'unknown',
        faces: [...(declarations.filterAxisFaces[axis] ?? [])],
      })),
      refused: [...declarations.refusedFilterAxes],
      refusedNote:
        '`context` is refused **as a default** only — [SD §1.4] rule 1: "A consumer filtering by ' +
        'subject MUST NOT be served context matches by default." An explicitly named opt-in is ' +
        'not refused.',
    },
    compatibility: {
      note:
        'Closed vocabulary, addition-only within a major — [catalog §2.3]. Validate a record ' +
        'against the `specVersion` it carries, never against a pinned one, and treat an ' +
        'unfamiliar member of a closed enum as unhandled rather than as invalid.',
      additive: [...declarations.additiveChanges],
      breaking: [...declarations.breakingChanges],
    },
    owed: {
      note:
        'What the model declares undecided — [SD §0] forbids guessing a value to make the types ' +
        'tidy. Published here so a consumer sees the gaps without reading the analysis. The A4 ' +
        'reason vocabulary was the one that most affected this contract and it landed at `0.2.0` ' +
        '([A4 §3]); what caps this version now is the authority rows, 19 of 31 of which are owed ' +
        'in whole or in part.',
      counts: {
        declared: owed.declared.length,
        vocabularies: owed.vocabularies.length,
        authorityRows: owed.authorityRows.length,
        declaredRecordTypes: owed.declaredRecordTypes,
        factClassFamilies: owed.factClassFamilies.length,
        absentFactClasses: owed.absentFactClasses.length,
      },
      vocabularies: owed.vocabularies.map((entry) => entry.name),
      declared: owed.declared.map((entry) => ({
        what: entry.what,
        owedTo: entry.owedTo,
        where: entry.where,
      })),
      authorityRows: owed.authorityRows.map((row) => ({
        type: row.type,
        status: row.status,
        owedTo: row.owedTo,
        boundBy: row.boundBy,
      })),
      factClassFamilies: [...owed.factClassFamilies],
      absentFactClasses: [...owed.absentFactClasses],
    },
  }
}

/* ------------------------------------------------------------------------------------------------
 * The README
 * ---------------------------------------------------------------------------------------------- */

/**
 * Headings, paragraphs and bullets — no markdown table.
 *
 * The same constraint the glossary generator states: prettier re-pads table cells on commit, and a
 * generator that has to reproduce prettier's padding is a generator that will drift from it.
 */
function readmeDocument(declarations: Declarations): string {
  const lines: string[] = []
  lines.push('# The published event catalog')
  lines.push('')
  lines.push(
    `<!-- ${DO_NOT_EDIT}. Generated by \`${CATALOG_GENERATOR_REPO_PATH}\`; run \`${CATALOG_COMMAND}\`. -->`,
  )
  lines.push('')
  lines.push(
    'The versioned integration events a consumer subscribes to, at `specVersion` ' +
      `**${declarations.version}**. Every file here is generated from ` +
      '[`packages/domain-reference/src/`](../../../packages/domain-reference/src/), and none of ' +
      'them is written by hand.',
  )
  lines.push('')
  lines.push(
    'The decisions behind them — what is published, how it is versioned, and what a consumer may ' +
      'filter on — are in ' +
      '[`../analysis/published-event-catalog.md`](../analysis/published-event-catalog.md).',
  )
  lines.push('')

  lines.push('## The files')
  lines.push('')
  lines.push(
    `- [\`${CATALOG_FILES.captured}\`](${CATALOG_FILES.captured}) — the **captured** face: what ` +
      'anything asserting into the catalog must satisfy. `recordedAt` is forbidden ([SD §1.1]). A ' +
      '`PARTNER_ASSERTED` partner asserts against this one, so it is an external contract too.',
  )
  lines.push(
    `- [\`${CATALOG_FILES.queried}\`](${CATALOG_FILES.queried}) — the **queried** face: what ` +
      'anything reading out of it is served. `recordedAt` is mandatory.',
  )
  lines.push(
    `- [\`${CATALOG_FILES.index}\`](${CATALOG_FILES.index}) — the manifest: every published ` +
      'member with its canonical subject family and qualifier, the filter axes and the refused ' +
      'ones, the compatibility classification, and **the owed inventory**.',
  )
  lines.push('')

  lines.push('## What is published')
  lines.push('')
  lines.push(
    `**${declarations.members.length} members** — ${declarations.actTypes.length} act types, ` +
      `${declarations.nonActTypes.length} other assertion types and ` +
      `${declarations.metaTypes.length} meta-record types. That is the record vocabulary exactly: ` +
      'there is no curated subset and no coarser published layer, because one record carries one ' +
      '`type` and a second classification axis is permanently forbidden ([SD §1.1], [SD §1.3]).',
  )
  lines.push('')
  lines.push(
    'Both schema documents are **closed** (`additionalProperties: false`), and each field ' +
      '[SD §1.1] forbids on the envelope is emitted as `"field": false` — refused by name, not by ' +
      'silence. Validate a record against the `specVersion` it carries, never against a pinned one.',
  )
  lines.push('')

  lines.push('## What a consumer may filter on')
  lines.push('')
  lines.push(
    'The envelope, plus the keys derived from it. Nothing else, and `context[]` is never a ' +
      'default axis ([SD §1.4] rule 1).',
  )
  lines.push('')
  for (const axis of declarations.filterAxes) {
    const source = declarations.filterAxisSource[axis] ?? 'unknown'
    const faces = declarations.filterAxisFaces[axis] ?? []
    const only =
      faces.length === declarations.faces.length ? '' : ` — **${faces.join(', ')} face only**`
    lines.push(`- \`${axis}\` — ${source}${only}`)
  }
  lines.push('')
  lines.push(`Refused: ${declarations.refusedFilterAxes.map((axis) => `\`${axis}\``).join(', ')}.`)
  lines.push('')

  lines.push('## Regenerating')
  lines.push('')
  lines.push('```sh')
  lines.push(CATALOG_COMMAND)
  lines.push('```')
  lines.push('')
  lines.push(
    '`tests/conformance/catalog-staleness.test.ts` fails when what is committed and what the ' +
      'generator produces disagree, and the emitted bytes are a prettier fixed point so the ' +
      'pre-commit hook cannot rewrite them behind a green run.',
  )
  lines.push('')

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/* ------------------------------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------------------------------- */

async function formatted(contents: string, file: string): Promise<string> {
  const config = await prettier.resolveConfig(`${CATALOG_DIR}${file}`)
  return prettier.format(contents, {
    ...config,
    parser: file.endsWith('.md') ? 'markdown' : 'json',
  })
}

/**
 * Every emitted file, keyed by its name under {@link CATALOG_REPO_DIR}.
 *
 * Returned rather than written, so the staleness test can regenerate in memory and compare without
 * touching the working tree.
 */
export async function generateCatalog(): Promise<ReadonlyMap<string, string>> {
  const model = buildModel()
  const declarations = readDeclarations(model)
  const bundles = bundlesFor(model, declarations)

  const files = new Map<string, string>()
  for (const bundle of bundles) {
    const name = CATALOG_FILES[bundle.face]
    files.set(name, await formatted(JSON.stringify(bundle.document, null, 2), name))
  }
  files.set(
    CATALOG_FILES.index,
    await formatted(JSON.stringify(indexDocument(declarations), null, 2), CATALOG_FILES.index),
  )
  files.set(
    CATALOG_FILES.readme,
    await formatted(readmeDocument(declarations), CATALOG_FILES.readme),
  )
  return files
}

/** The file as committed, or `undefined` if it is not there yet. */
export function committedCatalogFile(file: string): string | undefined {
  try {
    return readFileSync(`${CATALOG_DIR}${file}`, 'utf8')
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  const files = await generateCatalog()
  mkdirSync(CATALOG_DIR, { recursive: true })
  for (const [name, contents] of files) {
    writeFileSync(`${CATALOG_DIR}${name}`, contents, 'utf8')
    process.stdout.write(`wrote ${CATALOG_REPO_DIR}/${name}\n`)
  }
}
