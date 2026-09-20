/**
 * The data tables, and the loaders that refuse a bad one.
 *
 * Three things in this package change on their own cadence and are therefore **data validated
 * against the model**, not more types: [SD §4.7]'s canonical-subject table, [A8 §5]'s per-fact-class
 * authority table, and the reason vocabulary's shape ([SD §2.4]), whose *content* is owed to A4 and
 * is shipped empty rather than guessed.
 *
 * Why data and not types. [SD §4.7] note 3 says the authority column "is [A8]'s, **quoted, not
 * re-derived**", and [A8 §9] lists ten things A8 still owes. A table that will be rewritten as its
 * owed rows land is a table, and a `.ts` file full of string literals is a table with extra steps.
 * What the types keep is the *schema*: every row is checked against the vocabulary in `src/` at
 * load, so the two cannot drift apart quietly.
 *
 * **The loaders are pure.** They take parsed JSON and return validated structures. Nothing here
 * reads a file, and nothing here imports one — the caller supplies the parsed value, which is what
 * lets the same check run over a table that has not been written to disk yet.
 *
 * The four failure modes the brief names, and where each is enforced:
 *
 * | Defect                                          | Enforced by                                    |
 * | ----------------------------------------------- | ---------------------------------------------- |
 * | an unknown record type                          | {@link readAssertionType}                      |
 * | a missing (or undeclared) family                | {@link readFamilyName} + the agreement check   |
 * | a family member that is not an aggregate kind   | {@link readAggregateKind}                      |
 * | an authority value that is neither a role nor `owed` | {@link readRoleName} / {@link readStanding} |
 *
 * Every failure throws {@link DataDefect} naming the JSON path. A table that half-loads is worse
 * than one that refuses: [SD §4.7.2e] is the record of a binding document specifying a record that
 * could not be published, and it went unnoticed because nothing checked.
 */

import { ROLE_NAMES, type RoleName } from './envelope'
import { isAggregateKind, type AggregateKind } from './ids'
import type { Exact, NonEmptyArray } from './primitives'
import {
  OUTCOMES,
  REASON_CODE_OTHER,
  REASON_SCOPES,
  reasonsAreRequired,
  type Outcome,
  type ReasonScope,
} from './outcomes'
import {
  ASSERTION_TYPES,
  CANONICAL_SUBJECT_FAMILY,
  HANDOVER_SIDES,
  META_RECORD_TYPES,
  SUBJECT_FAMILIES,
  isAssertionType,
  type AssertionType,
  type QualifierByType,
  type SubjectFamilyName,
} from './vocabulary'

/* ────────────────────────────────  failure  ──────────────────────────────── */

/**
 * A table that does not agree with the model.
 *
 * It carries the JSON path because the useful question about a defect is *which row*, and a
 * validator that answers "invalid" is a validator nobody runs twice.
 */
export class DataDefect extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'DataDefect'
  }
}

function fail(path: string, detail: string): never {
  throw new DataDefect(path, detail)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/* ────────────────────────────  primitive readers  ───────────────────────── */

type JsonObject = Readonly<Record<string, unknown>>

function readObject(path: string, value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, `expected an object, found ${describe(value)}`)
  }
  return value as JsonObject
}

function readArray(path: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, `expected an array, found ${describe(value)}`)
  return value
}

function readString(path: string, value: unknown): string {
  if (typeof value !== 'string') return fail(path, `expected a string, found ${describe(value)}`)
  if (value.length === 0) return fail(path, 'expected a non-empty string')
  return value
}

/**
 * A field that is allowed to be absent — written as `null` in the tables, accepted as missing.
 *
 * It is deliberately NOT the same thing as an owed value. `contextNote: null` means the row has no
 * note; an owed authority says `"status": "owed"` and names who owes it. [SD §0]'s disclosure rule
 * is the reason the two cannot share a spelling.
 */
function readStringOrNull(path: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  return readString(path, value)
}

function readBoolean(path: string, value: unknown): boolean {
  if (typeof value !== 'boolean') return fail(path, `expected a boolean, found ${describe(value)}`)
  return value
}

function readInteger(path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(path, `expected an integer, found ${describe(value)}`)
  }
  return value
}

function readMember<T extends string>(path: string, value: unknown, allowed: readonly T[]): T {
  const raw = readString(path, value)
  const found = allowed.find((candidate) => candidate === raw)
  if (found === undefined) {
    return fail(path, `${JSON.stringify(raw)} is not one of ${allowed.join(' | ')}`)
  }
  return found
}

function readStrings(path: string, value: unknown): readonly string[] {
  return readArray(path, value).map((item, index) => readString(`${path}[${index}]`, item))
}

function readNonEmpty<T>(path: string, items: readonly T[], what: string): NonEmptyArray<T> {
  const [head, ...tail] = items
  if (head === undefined) return fail(path, `expected at least one ${what}`)
  return [head, ...tail]
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const l = new Set(left)
  const r = new Set(right)
  return l.size === r.size && [...l].every((member) => r.has(member))
}

/* ───────────────────────────  vocabulary readers  ───────────────────────── */

/**
 * **Unknown record type.** E-TYPE ([SD §1.3]) admits nothing outside the one published vocabulary,
 * so a row naming a type that is not in it is refused rather than carried.
 *
 * The two meta-record types get their own message: they are legal `type` values but deliberately
 * have no [SD §4.7.1] row, because [SD §1.3] item 4 fixes their subject rule elsewhere ("the
 * envelope `subject` MUST equal the subject of the fact being resolved or corrected"). A row for
 * one of them would be a declaration [SD §4.7] never made.
 */
function readAssertionType(path: string, value: unknown): AssertionType {
  const raw = readString(path, value)
  if ((META_RECORD_TYPES as readonly string[]).includes(raw)) {
    return fail(
      path,
      `${raw} is a meta-record type and has no [SD §4.7.1] row by design — its subject rule is [SD §1.3] item 4`,
    )
  }
  if (!isAssertionType(raw)) {
    return fail(path, `${JSON.stringify(raw)} is not a member of the published record vocabulary`)
  }
  return raw
}

/** **A family member that is not an aggregate kind** — [SD §1.2]'s closed enum decides this. */
function readAggregateKind(path: string, value: unknown): AggregateKind {
  const raw = readString(path, value)
  if (!isAggregateKind(raw)) {
    return fail(path, `${JSON.stringify(raw)} is not a member of the aggregate enum ([SD §1.2])`)
  }
  return raw
}

const FAMILY_NAMES = Object.keys(SUBJECT_FAMILIES) as readonly SubjectFamilyName[]

/** **A missing or undeclared family** — [SD §4.7] note 2: a family is a *named* closed set. */
function readFamilyName(path: string, value: unknown): SubjectFamilyName {
  return readMember(path, value, FAMILY_NAMES)
}

/**
 * **An authority value that is neither a role nor `owed`.**
 *
 * A bare string in an authority position must be a member of the role vocabulary. Anything else —
 * "the tariff owner", "the leg's authoritativeAsserter", "everyone else" — is a designation the
 * role enum does not contain, and the tables carry those in `unresolved`, each naming what it is
 * owed to ([A8 §9 item 2] for the enum, [A8 §9 item 1] for the party entity). The split is the
 * whole point: it makes the gap countable instead of letting prose sit where a role belongs.
 */
function readRoleName(path: string, value: unknown): RoleName {
  const raw = readString(path, value)
  const found = ROLE_NAMES.find((role) => role === raw)
  if (found === undefined) {
    return fail(
      path,
      `${JSON.stringify(raw)} is not a role ([A8 §2]); a non-enum asserter belongs in "unresolved" with what it is owed to`,
    )
  }
  return found
}

function readRoleNames(path: string, value: unknown): readonly RoleName[] {
  return readArray(path, value).map((item, index) => readRoleName(`${path}[${index}]`, item))
}

/* ─────────────────────  the canonical-subject table  ────────────────────── */

/** [SD §4.7] note 3 / [A8 §10]'s last row. No row may claim more than this. */
export const SCORINGS = ['capped-medium', 'do-not-score'] as const
export type Scoring = (typeof SCORINGS)[number]

/** [A8 §4.3]. */
export const BOUND_BY_VALUES = ['CUSTODY', 'ASSIGNMENT', 'SCHEME', 'PRINCIPAL', 'NONE'] as const
export type BoundByValue = (typeof BOUND_BY_VALUES)[number]

/**
 * What a row may say about `boundBy`.
 *
 * `owed` and `unassigned` are two spellings the documents actually use and they are kept apart on
 * purpose: [SD §4.7.1]'s lifecycle rows say **owed** and name what is owed ("`boundBy` **owed** —
 * _not_ `CUSTODY`"), while its `weight.gross` / `weight.tare` rows say **unassigned**, which is a
 * weaker statement — nobody has said what binds it and nobody is on the hook to. Collapsing them
 * would invent a ledger entry for the second pair.
 */
export const BOUND_BY_DECLARATIONS = [...BOUND_BY_VALUES, 'owed', 'unassigned'] as const
export type BoundByDeclaration = (typeof BOUND_BY_DECLARATIONS)[number]

/**
 * The four types that declare a `qualifier` — [SD §1.3] item 3, [SD §4.7.2].
 *
 * `handover` is the fourth, added by [SD §4.7.2f]: it is the type whose **subject does not change**
 * across successive facts about it, which is exactly why it could not use [SD §4.7.2d] item 3's
 * "the discriminator stays the subject" remedy and needed a qualifier instead.
 *
 * `Exact` couples the runtime list to `QualifierByType`: a fifth qualifier declared in the types
 * and not here (or here and not there) stops this module compiling, which is the only way a data
 * check over a type-level table stays true.
 */
export const QUALIFIER_TYPES = ['identity', 'pieceCount', 'charge', 'handover'] as const
type QualifierTypesAreExact = Exact<(typeof QUALIFIER_TYPES)[number], keyof QualifierByType>
const _qualifierTypesAreExact: QualifierTypesAreExact = true
void _qualifierTypesAreExact

/** The field names each qualifier declares, tied to the interface by `satisfies` + `Exact`. */
export const QUALIFIER_FIELDS = {
  identity: ['scheme', 'vocabularyScope'],
  pieceCount: ['unitization'],
  charge: ['aspect'],
  handover: ['releasing', 'receiving', 'side', 'occurrence'],
} as const satisfies {
  readonly [K in keyof QualifierByType]: readonly (keyof QualifierByType[K])[]
}

type QualifierFieldsAreExact = {
  readonly [K in keyof QualifierByType]: Exact<
    (typeof QUALIFIER_FIELDS)[K][number],
    keyof QualifierByType[K]
  >
}
const _qualifierFieldsAreExact: QualifierFieldsAreExact = {
  identity: true,
  pieceCount: true,
  charge: true,
  handover: true,
}
void _qualifierFieldsAreExact

/**
 * Where a qualifier component **enumerates**, its members — the same "two spellings of one closed
 * set" discipline the families already get, one column over.
 *
 * A component that does not enumerate has no entry and the row writes `values: null`:
 * `identity`'s `scheme` is an owed code list and its `vocabularyScope` is a structure, so inventing
 * an enum for either would be the guess [SD §0] forbids. `handover`'s `occurrence` is "integer ≥ 1"
 * and is unbounded, so it does not enumerate either — {@link handoverOccurrenceIsWellFormed} is its
 * check, not a member list.
 */
type EnumeratedQualifierValues = {
  readonly [K in keyof QualifierByType]?: {
    readonly [F in keyof QualifierByType[K]]?: readonly NonNullable<QualifierByType[K][F]>[]
  }
}

export const QUALIFIER_VALUES = {
  pieceCount: { unitization: ['UNITIZED', 'NON_UNITIZED'] },
  charge: { aspect: ['PROPOSED', 'DECIDED', 'RATED'] },
  handover: { side: HANDOVER_SIDES },
} as const satisfies EnumeratedQualifierValues

export type QualifierTypeName = (typeof QUALIFIER_TYPES)[number]

export interface QualifierDeclaration {
  readonly fields: NonEmptyArray<string>
  /** `null` where the field does not enumerate — `identity`'s scheme is an owed code list. */
  readonly values: Readonly<Record<string, NonEmptyArray<string>>> | null
  readonly marker: string | null
  readonly citation: string
}

/**
 * A row's pointer into [A8 §5].
 *
 * `sameType: false` is legal and is not a typo: `pieceCount` points at row 9 (`condition`) because
 * A8-JOINT reaches "condition **and the counts asserted with it**" and [A8 §5] has no `pieceCount`
 * row of its own. A cross-type link must say why, so that a table which merely *looks* covered
 * cannot pass for one that is.
 */
export interface A8Link {
  readonly row: number
  readonly sameType: boolean
  readonly why: string | null
}

/** [SD §4.7] note 3: a provisional reading is marked, and may never score a dependent decision. */
export interface ProvisionalReading {
  readonly marker: string
  readonly reading: string
  readonly roles: readonly RoleName[]
}

export type RowAuthority =
  | {
      readonly status: 'assigned'
      readonly boundBy: BoundByDeclaration
      readonly a8Row: A8Link | null
      readonly summary: string
      readonly scoring: Scoring
      readonly citations: NonEmptyArray<string>
    }
  | {
      /** Assigned in one named scope and owed outside it — [SD §4.7.1]'s `pieceCount` row. */
      readonly status: 'conditional'
      readonly boundBy: BoundByDeclaration
      readonly a8Row: A8Link | null
      readonly assignedWhen: string
      readonly owedWhen: string
      readonly owedTo: string
      readonly summary: string
      readonly scoring: Scoring
      readonly citations: NonEmptyArray<string>
    }
  | {
      readonly status: 'owed'
      readonly boundBy: BoundByDeclaration
      readonly owedTo: string
      readonly provisional: ProvisionalReading | null
      readonly scoring: 'do-not-score'
      readonly citations: NonEmptyArray<string>
    }

export interface CanonicalSubjectRow {
  readonly type: AssertionType
  /** [SD §4.7] note 5: these must never appear in a record. Held so a reader can map them. */
  readonly proseAliases: readonly string[]
  readonly family: SubjectFamilyName
  readonly qualifier: QualifierDeclaration | null
  /** [SD §1.4]: non-authoritative, never the resolution key. */
  readonly context: readonly AggregateKind[]
  readonly contextNote: string | null
  readonly boundByNote: string | null
  readonly authority: RowAuthority
  readonly citations: NonEmptyArray<string>
}

export interface FamilyDeclaration {
  readonly name: SubjectFamilyName
  readonly members: NonEmptyArray<AggregateKind>
  readonly singleton: boolean
  readonly marker: string | null
  readonly citation: string
}

export interface CanonicalSubjectTable {
  readonly families: ReadonlyMap<SubjectFamilyName, FamilyDeclaration>
  readonly rows: ReadonlyMap<AssertionType, CanonicalSubjectRow>
}

function readQualifier(
  path: string,
  value: unknown,
  type: AssertionType,
): QualifierDeclaration | null {
  const declares = (QUALIFIER_TYPES as readonly string[]).includes(type)
  if (value === null || value === undefined) {
    if (declares) {
      return fail(path, `${type} declares a qualifier ([SD §4.7.2]) and this row omits it`)
    }
    return null
  }
  if (!declares) {
    // [SD §1.3] item 3: "a type that declares none has none, and its fact key is (subject, type)."
    // A stray qualifier here would silently split one contest into several.
    return fail(path, `${type} declares no qualifier ([SD §1.3] item 3) and this row supplies one`)
  }
  const object = readObject(path, value)
  const fields = readNonEmpty(
    `${path}.fields`,
    readStrings(`${path}.fields`, object['fields']),
    'field',
  )
  const declared: readonly string[] = QUALIFIER_FIELDS[type as QualifierTypeName]
  if (!sameSet(fields, declared)) {
    return fail(
      `${path}.fields`,
      `declares [${fields.join(', ')}] where the type declares [${declared.join(', ')}]`,
    )
  }
  const rawValues = object['values']
  let values: Record<string, NonEmptyArray<string>> | null = null
  if (rawValues !== null && rawValues !== undefined) {
    const valuesObject = readObject(`${path}.values`, rawValues)
    values = {}
    for (const [field, members] of Object.entries(valuesObject)) {
      if (!fields.includes(field)) {
        return fail(`${path}.values.${field}`, `is not one of the declared fields`)
      }
      values[field] = readNonEmpty(
        `${path}.values.${field}`,
        readStrings(`${path}.values.${field}`, members),
        'value',
      )
    }
  }
  // The agreement check, as the families get: a component that enumerates in the types must
  // enumerate the same members here, or the two closed sets can drift apart quietly — and this one
  // is load-bearing, because `loadDomainTables` splits [A8 §5]'s authority on these very members.
  const enumerated: Readonly<Record<string, readonly string[]>> | undefined = (
    QUALIFIER_VALUES as Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  )[type]
  for (const [field, inCode] of Object.entries(enumerated ?? {})) {
    const declared = values?.[field]
    if (declared === undefined) {
      return fail(
        `${path}.values.${field}`,
        `${type}'s ${field} enumerates in the types and this row declares no members for it`,
      )
    }
    if (!sameSet(declared, inCode)) {
      return fail(
        `${path}.values.${field}`,
        `is [${declared.join(', ')}] where the type declares [${inCode.join(', ')}]`,
      )
    }
  }

  return {
    fields,
    values,
    marker: readStringOrNull(`${path}.marker`, object['marker']),
    citation: readString(`${path}.citation`, object['citation']),
  }
}

function readA8Link(path: string, value: unknown): A8Link | null {
  if (value === null || value === undefined) return null
  const object = readObject(path, value)
  const row = readInteger(`${path}.row`, object['row'])
  const sameType = readBoolean(`${path}.sameType`, object['sameType'])
  const why = readStringOrNull(`${path}.why`, object['why'])
  if (!sameType && why === null) {
    return fail(`${path}.why`, 'a link to a row for a different type must say why')
  }
  return { row, sameType, why }
}

function readCitations(path: string, value: unknown): NonEmptyArray<string> {
  // [SD §0] as applied to this package: "a rule with no citation and no marker is a defect."
  return readNonEmpty(path, readStrings(path, value), 'citation')
}

function readRowAuthority(path: string, value: unknown): RowAuthority {
  const object = readObject(path, value)
  const status = readMember(`${path}.status`, object['status'], [
    'assigned',
    'conditional',
    'owed',
  ] as const)
  const boundBy = readMember(`${path}.boundBy`, object['boundBy'], BOUND_BY_DECLARATIONS)
  const citations = readCitations(`${path}.citations`, object['citations'])

  switch (status) {
    case 'assigned':
      return {
        status,
        boundBy,
        a8Row: readA8Link(`${path}.a8Row`, object['a8Row']),
        summary: readString(`${path}.summary`, object['summary']),
        scoring: readMember(`${path}.scoring`, object['scoring'], SCORINGS),
        citations,
      }
    case 'conditional':
      return {
        status,
        boundBy,
        a8Row: readA8Link(`${path}.a8Row`, object['a8Row']),
        assignedWhen: readString(`${path}.assignedWhen`, object['assignedWhen']),
        owedWhen: readString(`${path}.owedWhen`, object['owedWhen']),
        owedTo: readString(`${path}.owedTo`, object['owedTo']),
        summary: readString(`${path}.summary`, object['summary']),
        scoring: readMember(`${path}.scoring`, object['scoring'], SCORINGS),
        citations,
      }
    case 'owed': {
      const rawProvisional = object['provisional']
      let provisional: ProvisionalReading | null = null
      if (rawProvisional !== null && rawProvisional !== undefined) {
        const p = readObject(`${path}.provisional`, rawProvisional)
        provisional = {
          marker: readString(`${path}.provisional.marker`, p['marker']),
          reading: readString(`${path}.provisional.reading`, p['reading']),
          roles: readRoleNames(`${path}.provisional.roles`, p['roles']),
        }
      }
      // [SD §4.7] note 3: a provisional reading "may not be used to score a dependent decision
      // above medium". The table says `do-not-score` and the loader refuses anything weaker, so
      // the bar cannot be lifted by editing one field.
      const scoring = readMember(`${path}.scoring`, object['scoring'], SCORINGS)
      if (scoring !== 'do-not-score') {
        return fail(`${path}.scoring`, 'an owed authority may never be scored ([SD §4.7] note 3)')
      }
      return {
        status,
        boundBy,
        owedTo: readString(`${path}.owedTo`, object['owedTo']),
        provisional,
        scoring,
        citations,
      }
    }
    default:
      return fail(`${path}.status`, 'unreachable')
  }
}

function readFamilies(
  path: string,
  value: unknown,
): ReadonlyMap<SubjectFamilyName, FamilyDeclaration> {
  const object = readObject(path, value)
  const members = readObject(`${path}.members`, object['members'])
  const families = new Map<SubjectFamilyName, FamilyDeclaration>()

  for (const [rawName, rawDeclaration] of Object.entries(members)) {
    const at = `${path}.members.${rawName}`
    const name = readFamilyName(at, rawName)
    const declaration = readObject(at, rawDeclaration)
    const kinds = readArray(`${at}.members`, declaration['members']).map((item, index) =>
      readAggregateKind(`${at}.members[${index}]`, item),
    )
    const nonEmpty = readNonEmpty(`${at}.members`, kinds, 'aggregate kind')
    const singleton = readBoolean(`${at}.singleton`, declaration['singleton'])
    if (singleton !== (nonEmpty.length === 1)) {
      return fail(`${at}.singleton`, `says ${singleton} for a family of ${nonEmpty.length}`)
    }
    // The agreement check. Two spellings of one closed set that can drift are not one closed set,
    // and [SD §4.7] note 2 is the declaration both spellings claim to be.
    const inCode: readonly AggregateKind[] = SUBJECT_FAMILIES[name]
    if (!sameSet(nonEmpty, inCode)) {
      return fail(
        `${at}.members`,
        `is [${nonEmpty.join(', ')}] where SUBJECT_FAMILIES.${name} is [${inCode.join(', ')}]`,
      )
    }
    families.set(name, {
      name,
      members: nonEmpty,
      singleton,
      marker: readStringOrNull(`${at}.marker`, declaration['marker']),
      citation: readString(`${at}.citation`, declaration['citation']),
    })
  }

  for (const name of FAMILY_NAMES) {
    if (!families.has(name)) return fail(`${path}.members.${name}`, 'declared in code, absent here')
  }
  return families
}

/**
 * [SD §4.7.1], validated.
 *
 * The completeness check is the one that matters: [SD §1.3] makes §4.7.1 the **complete**
 * declaration, so a vocabulary member with no row is exactly the defect [SD §4.7.2e] found in the
 * order lifecycle — "a binding document… specifying a record that could not be published".
 */
export function loadCanonicalSubjects(raw: unknown): CanonicalSubjectTable {
  const root = readObject('canonical-subjects', raw)
  const families = readFamilies('canonical-subjects.families', root['families'])
  const rows = new Map<AssertionType, CanonicalSubjectRow>()

  readArray('canonical-subjects.rows', root['rows']).forEach((rawRow, index) => {
    const at = `canonical-subjects.rows[${index}]`
    const object = readObject(at, rawRow)
    const type = readAssertionType(`${at}.type`, object['type'])
    if (rows.has(type)) fail(`${at}.type`, `${type} already has a row; one type, one declaration`)

    const family = readFamilyName(`${at}.family`, object['family'])
    const declaredInCode: SubjectFamilyName = CANONICAL_SUBJECT_FAMILY[type]
    if (family !== declaredInCode) {
      fail(`${at}.family`, `says ${family} where CANONICAL_SUBJECT_FAMILY says ${declaredInCode}`)
    }

    const context = readArray(`${at}.context`, object['context']).map((item, memberIndex) =>
      readAggregateKind(`${at}.context[${memberIndex}]`, item),
    )

    rows.set(type, {
      type,
      proseAliases: readStrings(`${at}.proseAliases`, object['proseAliases']),
      family,
      qualifier: readQualifier(`${at}.qualifier`, object['qualifier'], type),
      context,
      contextNote: readStringOrNull(`${at}.contextNote`, object['contextNote']),
      boundByNote: readStringOrNull(`${at}.boundByNote`, object['boundByNote']),
      authority: readRowAuthority(`${at}.authority`, object['authority']),
      citations: readCitations(`${at}.citations`, object['citations']),
    })
  })

  for (const type of ASSERTION_TYPES) {
    if (!rows.has(type)) {
      fail(
        'canonical-subjects.rows',
        `${type} is in the published vocabulary and has no row — [SD §1.3] makes [SD §4.7.1] the COMPLETE declaration`,
      )
    }
  }
  return { families, rows }
}

/* ──────────────────────────  the authority table  ───────────────────────── */

/**
 * How many roles hold a standing **at one instant**.
 *
 * [A8 §4]'s shape comments its own field: `authoritative roleRef[]` is "usually one; **two only at
 * a joint instant** (§7.3)". Several rows list two roles that are *alternatives* — `loadAgent`,
 * or `originAgent` where no separate load agent is assigned — and those are one authority with two
 * cases, not a plural one. The distinction is load-bearing because A8-NAMED ([A8 §4.4]) keys on it:
 * empty or genuinely plural obliges a named rule, alternatives do not.
 */
export const CARDINALITIES = ['one', 'alternatives', 'joint', 'empty'] as const
export type Cardinality = (typeof CARDINALITIES)[number]

/** A designation the role enum does not contain, and what it is owed to. Never a bare string. */
export interface UnresolvedAsserter {
  readonly designation: string
  readonly owedTo: string
}

export interface TableStanding {
  readonly roles: readonly RoleName[]
  readonly unresolved: readonly UnresolvedAsserter[]
  readonly note: string | null
}

export interface AuthoritativeStanding extends TableStanding {
  readonly cardinality: Cardinality
}

/** What settles the value where no role does — [A8 §4.4] A8-NAMED: never implicit recency. */
export interface Settlement {
  readonly kind: 'valueRule' | 'derivation' | 'joint'
  readonly ruleId: string
  readonly citation: string
  readonly note: string | null
}

/** [A8 §5 r7] only: authority over the derivation's **input**, not over the fact the row names. */
export interface InputAuthority {
  readonly appliesTo: string
  readonly roles: readonly RoleName[]
  readonly unresolved: readonly UnresolvedAsserter[]
  readonly note: string | null
}

export type RowStandings =
  | {
      readonly kind: 'uniform'
      readonly authoritative: AuthoritativeStanding
      readonly corroborating: TableStanding
      readonly competing: TableStanding
      readonly advisory: TableStanding
    }
  | {
      /** [SD §4.7.2b]'s correction of [A8 §5 row 11]: three fact keys, not one contest. */
      readonly kind: 'perQualifier'
      readonly qualifierField: string
      readonly authoritativeByValue: ReadonlyMap<string, AuthoritativeStanding>
      readonly corroborating: TableStanding
      readonly competing: TableStanding
      readonly advisory: TableStanding
      readonly note: string | null
    }

export interface AuthorityRow {
  readonly row: number
  readonly type: AssertionType
  readonly family: SubjectFamilyName
  readonly boundBy: BoundByDeclaration
  readonly sameAs: number | null
  readonly standings: RowStandings
  readonly settlement: Settlement | null
  readonly inputAuthority: InputAuthority | null
  readonly evidence: string
  readonly authored: string
  /** [A8 §10]. Four rows are citations; seven are [ORIGINAL] in the step that matters. */
  readonly confidence: 'high' | 'medium'
  readonly confidenceNote: string | null
  readonly citations: NonEmptyArray<string>
}

export interface AuthorityTable {
  readonly rows: ReadonlyMap<number, AuthorityRow>
  readonly byType: ReadonlyMap<AssertionType, AuthorityRow>
}

function readUnresolved(path: string, value: unknown): readonly UnresolvedAsserter[] {
  return readArray(path, value).map((item, index) => {
    const at = `${path}[${index}]`
    const object = readObject(at, item)
    return {
      designation: readString(`${at}.designation`, object['designation']),
      // Never optional. An unresolved asserter with no owedTo is prose sitting where a role
      // belongs, which is the one thing the roles/unresolved split exists to prevent.
      owedTo: readString(`${at}.owedTo`, object['owedTo']),
    }
  })
}

function readStanding(path: string, value: unknown): TableStanding {
  const object = readObject(path, value)
  return {
    roles: readRoleNames(`${path}.roles`, object['roles']),
    unresolved: readUnresolved(`${path}.unresolved`, object['unresolved']),
    note: readStringOrNull(`${path}.note`, object['note']),
  }
}

function readAuthoritativeStanding(path: string, value: unknown): AuthoritativeStanding {
  const object = readObject(path, value)
  const standing = readStanding(path, value)
  const cardinality = readMember(`${path}.cardinality`, object['cardinality'], CARDINALITIES)
  const held = standing.roles.length + standing.unresolved.length
  const consistent =
    cardinality === 'empty' ? held === 0 : cardinality === 'one' ? held === 1 : held >= 2
  if (!consistent) {
    return fail(`${path}.cardinality`, `says ${cardinality} for ${held} holder(s)`)
  }
  return { ...standing, cardinality }
}

function readSettlement(path: string, value: unknown): Settlement | null {
  if (value === null || value === undefined) return null
  const object = readObject(path, value)
  return {
    kind: readMember(`${path}.kind`, object['kind'], ['valueRule', 'derivation', 'joint'] as const),
    ruleId: readString(`${path}.ruleId`, object['ruleId']),
    citation: readString(`${path}.citation`, object['citation']),
    note: readStringOrNull(`${path}.note`, object['note']),
  }
}

function readStandings(path: string, value: unknown): RowStandings {
  const object = readObject(path, value)
  const kind = readMember(`${path}.kind`, object['kind'], ['uniform', 'perQualifier'] as const)
  const corroborating = readStanding(`${path}.corroborating`, object['corroborating'])
  const competing = readStanding(`${path}.competing`, object['competing'])
  const advisory = readStanding(`${path}.advisory`, object['advisory'])

  switch (kind) {
    case 'uniform':
      return {
        kind,
        authoritative: readAuthoritativeStanding(`${path}.authoritative`, object['authoritative']),
        corroborating,
        competing,
        advisory,
      }
    case 'perQualifier': {
      const byValue = new Map<string, AuthoritativeStanding>()
      const raw = readObject(`${path}.authoritativeByValue`, object['authoritativeByValue'])
      for (const [qualifierValue, standing] of Object.entries(raw)) {
        byValue.set(
          qualifierValue,
          readAuthoritativeStanding(`${path}.authoritativeByValue.${qualifierValue}`, standing),
        )
      }
      if (byValue.size === 0) fail(`${path}.authoritativeByValue`, 'declares no qualifier value')
      return {
        kind,
        qualifierField: readString(`${path}.qualifierField`, object['qualifierField']),
        authoritativeByValue: byValue,
        corroborating,
        competing,
        advisory,
        note: readStringOrNull(`${path}.note`, object['note']),
      }
    }
    default:
      return fail(`${path}.kind`, 'unreachable')
  }
}

/**
 * [A8 §5], validated.
 *
 * Eleven rows and no completeness check — deliberately. [A8 §9 item 8] records that every other
 * fact class is uncovered, so demanding a row per type here would turn A8's own disclosure into a
 * load failure. What *is* checked is the other direction: a row for a type the vocabulary does not
 * contain, a family that disagrees with [SD §4.7], and A8-NAMED.
 */
export function loadAuthorityTable(raw: unknown): AuthorityTable {
  const root = readObject('authority-table', raw)
  const rows = new Map<number, AuthorityRow>()
  const byType = new Map<AssertionType, AuthorityRow>()

  readArray('authority-table.rows', root['rows']).forEach((rawRow, index) => {
    const at = `authority-table.rows[${index}]`
    const object = readObject(at, rawRow)
    const row = readInteger(`${at}.row`, object['row'])
    if (rows.has(row)) fail(`${at}.row`, `row ${row} is declared twice`)

    const type = readAssertionType(`${at}.type`, object['type'])
    if (byType.has(type)) fail(`${at}.type`, `${type} already has an [A8 §5] row`)

    const family = readFamilyName(`${at}.family`, object['family'])
    const declaredInCode: SubjectFamilyName = CANONICAL_SUBJECT_FAMILY[type]
    if (family !== declaredInCode) {
      // [A8 §5] caveat (i): the subject column is [SD §4.7]'s declaration, "quoted… nothing in
      // this column is assumed". A disagreement here is the quotation having gone stale.
      fail(`${at}.family`, `quotes ${family} where [SD §4.7] declares ${declaredInCode}`)
    }

    const standings = readStandings(`${at}.standings`, object['standings'])
    const settlement = readSettlement(`${at}.settlement`, object['settlement'])

    // **Rule A8-NAMED** ([A8 §4.4]). "Where `authoritative` is empty or plural for a contested
    // fact, `FactResolved` MUST name a tie-break rule… A resolution may never fall back to
    // 'latest wins' implicitly." A row that leaves both blank is that fallback, in a table.
    if (standings.kind === 'uniform') {
      const { cardinality } = standings.authoritative
      const needsRule = cardinality === 'empty' || cardinality === 'joint'
      if (needsRule && settlement === null) {
        fail(
          `${at}.settlement`,
          `authoritative is ${cardinality}; A8-NAMED requires a named rule ([A8 §4.4])`,
        )
      }
    }

    const rawInput = object['inputAuthority']
    let inputAuthority: InputAuthority | null = null
    if (rawInput !== null && rawInput !== undefined) {
      const input = readObject(`${at}.inputAuthority`, rawInput)
      inputAuthority = {
        appliesTo: readString(`${at}.inputAuthority.appliesTo`, input['appliesTo']),
        roles: readRoleNames(`${at}.inputAuthority.roles`, input['roles']),
        unresolved: readUnresolved(`${at}.inputAuthority.unresolved`, input['unresolved']),
        note: readStringOrNull(`${at}.inputAuthority.note`, input['note']),
      }
    }

    const declaration: AuthorityRow = {
      row,
      type,
      family,
      boundBy: readMember(`${at}.boundBy`, object['boundBy'], BOUND_BY_DECLARATIONS),
      sameAs:
        object['sameAs'] === null || object['sameAs'] === undefined
          ? null
          : readInteger(`${at}.sameAs`, object['sameAs']),
      standings,
      settlement,
      inputAuthority,
      evidence: readString(`${at}.evidence`, object['evidence']),
      authored: readString(`${at}.authored`, object['authored']),
      confidence: readMember(`${at}.confidence`, object['confidence'], ['high', 'medium'] as const),
      confidenceNote: readStringOrNull(`${at}.confidenceNote`, object['confidenceNote']),
      citations: readCitations(`${at}.citations`, object['citations']),
    }
    rows.set(row, declaration)
    byType.set(type, declaration)
  })

  for (const declaration of rows.values()) {
    if (declaration.sameAs !== null && !rows.has(declaration.sameAs)) {
      fail(
        `authority-table.rows[row ${declaration.row}].sameAs`,
        `names missing row ${declaration.sameAs}`,
      )
    }
  }
  return { rows, byType }
}

/* ───────────────────────────  the reason table  ─────────────────────────── */

export interface ReasonShapeField {
  readonly field: string
  readonly obligation: string
  readonly from: string
  readonly marker: string | null
  readonly citation: string
}

export interface ReasonCodeEntry {
  readonly code: string
  readonly scope: ReasonScope
  readonly citation: string
}

export interface OutcomeDeclaration {
  readonly outcome: Outcome
  readonly means: string
  readonly reasonsRequired: boolean
  readonly reasonsForbidden: boolean
  readonly firstClassNote: string | null
  readonly marker: string | null
  readonly provenance: string
  readonly citation: string
}

export interface ReasonVocabulary {
  /** `owed` until A4 lands. The loader refuses an owed vocabulary that carries codes. */
  readonly status: 'owed' | 'published'
  readonly owedTo: string | null
  readonly codes: readonly ReasonCodeEntry[]
  readonly openMemberCode: string
  readonly shapeFields: NonEmptyArray<ReasonShapeField>
  readonly forbiddenFields: readonly string[]
  readonly scopes: readonly ReasonScope[]
  readonly outcomes: readonly OutcomeDeclaration[]
  readonly rules: readonly {
    readonly rule: number
    readonly statement: string
    readonly marker: string
    readonly citation: string
  }[]
  /** [SD §2.6]'s worked literals. Kept apart from `codes` and never merged into it. */
  readonly illustrativeOnly: readonly ReasonCodeEntry[]
}

/**
 * A reason code that names an outcome — the mirror of **A-TYPE** ([SD §2.5]) one axis over.
 *
 * **What this catches and what it cannot.** It catches a code containing an outcome member's own
 * name (`CANCELLED_BY_SHIPPER`). It does **not** catch [SD §2.4] rule 1's own example —
 * `DELIVERED_SHORT` / `REFUSED_SHORT` — because those encode the outcome in a *verb*, and the only
 * way to catch them is to know the act vocabulary's participles, which no document publishes.
 * Stated rather than papered over: this is a partial check, and rule 1 still needs a reader.
 */
function outcomeWordIn(code: string): Outcome | null {
  const lowered = code.toLowerCase()
  return OUTCOMES.find((outcome) => lowered.includes(outcome.toLowerCase())) ?? null
}

function readReasonCodeEntry(path: string, value: unknown): ReasonCodeEntry {
  const object = readObject(path, value)
  const code = readString(`${path}.code`, object['code'])
  if (code === REASON_CODE_OTHER) {
    // [SD §2.4] rule 3: OTHER is declared by the shape and carries an obligation the others do
    // not. A4 owning it too would make `remark`'s mandatory case a vocabulary decision.
    fail(`${path}.code`, 'OTHER is declared by [SD §2.4] rule 3, not by the vocabulary A4 owes')
  }
  const offending = outcomeWordIn(code)
  if (offending !== null) {
    fail(
      `${path}.code`,
      `names the outcome ${offending}; reasons are reused across outcomes ([SD §2.4] rule 1)`,
    )
  }
  return {
    code,
    scope: readMember(`${path}.scope`, object['scope'], REASON_SCOPES),
    citation: readString(`${path}.citation`, object['citation']),
  }
}

/**
 * [SD §2.4], validated — the shape, not the list.
 *
 * The check with teeth is the smallest one: an `owed` vocabulary may not carry codes. A4 has not
 * been written, so a populated list here could only have been guessed, and [SD §0] forbids
 * guessing a value to make a table look finished.
 */
export function loadReasonVocabulary(raw: unknown): ReasonVocabulary {
  const root = readObject('reasons', raw)
  const vocabulary = readObject('reasons.vocabulary', root['vocabulary'])
  const status = readMember('reasons.vocabulary.status', vocabulary['status'], [
    'owed',
    'published',
  ] as const)
  const codes = readArray('reasons.vocabulary.codes', vocabulary['codes']).map((item, index) =>
    readReasonCodeEntry(`reasons.vocabulary.codes[${index}]`, item),
  )
  if (status === 'owed') {
    if (codes.length > 0) {
      fail(
        'reasons.vocabulary.codes',
        'an owed vocabulary carries no codes — A4 has not been written',
      )
    }
    readString('reasons.vocabulary.owedTo', vocabulary['owedTo'])
  } else if (codes.length === 0) {
    fail('reasons.vocabulary.codes', 'a published vocabulary with no members is an owed one')
  }

  const shape = readObject('reasons.shape', root['shape'])
  const shapeFields = readNonEmpty(
    'reasons.shape.fields',
    readArray('reasons.shape.fields', shape['fields']).map((item, index) => {
      const at = `reasons.shape.fields[${index}]`
      const object = readObject(at, item)
      return {
        field: readString(`${at}.field`, object['field']),
        obligation: readString(`${at}.obligation`, object['obligation']),
        from: readString(`${at}.from`, object['from']),
        marker: readStringOrNull(`${at}.marker`, object['marker']),
        citation: readString(`${at}.citation`, object['citation']),
      }
    }),
    'field',
  )
  const forbiddenFields = readArray('reasons.shape.forbiddenFields', shape['forbiddenFields']).map(
    (item, index) =>
      readString(
        `reasons.shape.forbiddenFields[${index}].field`,
        readObject(`reasons.shape.forbiddenFields[${index}]`, item)['field'],
      ),
  )
  for (const forbidden of forbiddenFields) {
    if (shapeFields.some((declared) => declared.field === forbidden)) {
      fail('reasons.shape', `declares "${forbidden}" as both a field and a forbidden one`)
    }
  }

  const openMember = readObject('reasons.openMember', root['openMember'])
  const openMemberCode = readString('reasons.openMember.code', openMember['code'])
  if (openMemberCode !== REASON_CODE_OTHER) {
    fail(
      'reasons.openMember.code',
      `is ${openMemberCode} where the shape declares ${REASON_CODE_OTHER}`,
    )
  }
  if (!readBoolean('reasons.openMember.remarkRequired', openMember['remarkRequired'])) {
    // [SD §2.4] rule 3, sourced twice. An open member without a narrative is the record both
    // OTM 5.7 and src:dp3-400ng Item 226A forbid.
    fail('reasons.openMember.remarkRequired', 'the open member requires a narrative')
  }

  const scopes = readArray('reasons.scopes', root['scopes']).map((item, index) =>
    readMember(
      `reasons.scopes[${index}].scope`,
      readObject(`reasons.scopes[${index}]`, item)['scope'],
      REASON_SCOPES,
    ),
  )
  if (!sameSet(scopes, REASON_SCOPES)) {
    fail(
      'reasons.scopes',
      `is [${scopes.join(', ')}] where REASON_SCOPES is [${REASON_SCOPES.join(', ')}]`,
    )
  }

  const outcomes = readArray('reasons.outcomes', root['outcomes']).map((item, index) => {
    const at = `reasons.outcomes[${index}]`
    const object = readObject(at, item)
    const outcome = readMember(`${at}.outcome`, object['outcome'], OUTCOMES)
    const required = readBoolean(`${at}.reasonsRequired`, object['reasonsRequired'])
    const forbidden = readBoolean(`${at}.reasonsForbidden`, object['reasonsForbidden'])
    // [SD §2.3] invariant 2, checked against the predicate rather than restated: the table and
    // `reasonsAreRequired` are two expressions of one invariant, and they must not diverge.
    if (required !== reasonsAreRequired(outcome)) {
      fail(`${at}.reasonsRequired`, `disagrees with reasonsAreRequired(${outcome})`)
    }
    if (forbidden !== (outcome === 'COMPLETED')) {
      fail(`${at}.reasonsForbidden`, 'reasons are forbidden at COMPLETED and only there')
    }
    if (required && forbidden) fail(at, 'reasons cannot be both required and forbidden')
    const declaration: OutcomeDeclaration = {
      outcome,
      means: readString(`${at}.means`, object['means']),
      reasonsRequired: required,
      reasonsForbidden: forbidden,
      firstClassNote: readStringOrNull(`${at}.firstClassNote`, object['firstClassNote']),
      marker: readStringOrNull(`${at}.marker`, object['marker']),
      provenance: readString(`${at}.provenance`, object['provenance']),
      citation: readString(`${at}.citation`, object['citation']),
    }
    return declaration
  })
  if (
    !sameSet(
      outcomes.map((o) => o.outcome),
      OUTCOMES,
    )
  ) {
    fail('reasons.outcomes', 'does not declare exactly the five members of OUTCOMES ([SD §2.2])')
  }
  // The settled point the task names: "completed with exception" is a FIRST-CLASS outcome, so the
  // table must say what makes it one rather than leave it as a member among five.
  const exception = outcomes.find((o) => o.outcome === 'COMPLETED_WITH_EXCEPTION')
  if (exception === undefined || exception.firstClassNote === null) {
    fail(
      'reasons.outcomes',
      'COMPLETED_WITH_EXCEPTION must record why it is first-class ([SD §2.2])',
    )
  }

  const rules = readArray('reasons.rules', root['rules']).map((item, index) => {
    const at = `reasons.rules[${index}]`
    const object = readObject(at, item)
    return {
      rule: readInteger(`${at}.rule`, object['rule']),
      statement: readString(`${at}.statement`, object['statement']),
      marker: readString(`${at}.marker`, object['marker']),
      citation: readString(`${at}.citation`, object['citation']),
    }
  })
  // [SD §2.4] publishes six rules the vocabulary must satisfy. Six, and this is which.
  if (
    rules.length !== 6 ||
    !sameSet(
      rules.map((r) => String(r.rule)),
      ['1', '2', '3', '4', '5', '6'],
    )
  ) {
    fail('reasons.rules', "must be exactly [SD §2.4]'s six rules, numbered 1-6")
  }

  const illustrative = readObject('reasons.illustrativeOnly', root['illustrativeOnly'])
  if (readBoolean('reasons.illustrativeOnly.normative', illustrative['normative'])) {
    fail('reasons.illustrativeOnly.normative', "[SD §2.6]'s worked literals are not a vocabulary")
  }
  const illustrativeCodes = readArray(
    'reasons.illustrativeOnly.reasonCodes',
    illustrative['reasonCodes'],
  ).map((item, index) =>
    readReasonCodeEntry(`reasons.illustrativeOnly.reasonCodes[${index}]`, item),
  )
  for (const entry of illustrativeCodes) {
    if (codes.some((published) => published.code === entry.code)) {
      fail(
        'reasons.illustrativeOnly.reasonCodes',
        `${entry.code} is also published; the two lists must not merge`,
      )
    }
  }

  return {
    status,
    owedTo: readStringOrNull('reasons.vocabulary.owedTo', vocabulary['owedTo']),
    codes,
    openMemberCode,
    shapeFields,
    forbiddenFields,
    scopes,
    outcomes,
    rules,
    illustrativeOnly: illustrativeCodes,
  }
}

/* ────────────────────────────  the three, joined  ───────────────────────── */

export interface DomainTables {
  readonly canonicalSubjects: CanonicalSubjectTable
  readonly authority: AuthorityTable
  readonly reasons: ReasonVocabulary
}

/**
 * Load all three and check what only the join can check.
 *
 * Each table is well-formed on its own and can still be wrong about the other two: a canonical row
 * can point at an authority row that does not exist, and [A8 §5 row 11]'s three aspects can drift
 * from the `{aspect}` values [SD §4.7.2b] declares. Those are exactly the defects the documents
 * themselves hit — §4.7.2b is a correction of an A8 row, and §4.7.2e is a missing row nobody
 * noticed — so they are worth a pass of their own.
 */
export function loadDomainTables(raw: {
  readonly canonicalSubjects: unknown
  readonly authority: unknown
  readonly reasons: unknown
}): DomainTables {
  const canonicalSubjects = loadCanonicalSubjects(raw.canonicalSubjects)
  const authority = loadAuthorityTable(raw.authority)
  const reasons = loadReasonVocabulary(raw.reasons)

  for (const row of authority.rows.values()) {
    if (!canonicalSubjects.rows.has(row.type)) {
      fail(`authority-table.rows[row ${row.row}].type`, `${row.type} has no [SD §4.7.1] row`)
    }
  }

  for (const row of canonicalSubjects.rows.values()) {
    const link = row.authority.status === 'owed' ? null : row.authority.a8Row
    if (link === null) continue
    const target = authority.rows.get(link.row)
    if (target === undefined) {
      fail(`canonical-subjects.rows[${row.type}].authority.a8Row`, `[A8 §5] has no row ${link.row}`)
    }
    if (link.sameType && target.type !== row.type) {
      fail(
        `canonical-subjects.rows[${row.type}].authority.a8Row`,
        `claims sameType but row ${link.row} is ${target.type}`,
      )
    }
    if (!link.sameType && target.type === row.type) {
      fail(
        `canonical-subjects.rows[${row.type}].authority.a8Row`,
        `denies sameType but row ${link.row} is ${row.type}`,
      )
    }
  }

  for (const row of authority.rows.values()) {
    if (row.standings.kind !== 'perQualifier') continue
    const canonical = canonicalSubjects.rows.get(row.type)
    const qualifier = canonical?.qualifier ?? null
    if (qualifier === null) {
      fail(
        `authority-table.rows[row ${row.row}].standings`,
        `splits authority per qualifier where ${row.type} declares none ([SD §1.3] item 3)`,
      )
    }
    const field = row.standings.qualifierField
    if (!qualifier.fields.includes(field)) {
      fail(
        `authority-table.rows[row ${row.row}].standings.qualifierField`,
        `${field} is not one of [${qualifier.fields.join(', ')}]`,
      )
    }
    const declared = qualifier.values?.[field] ?? null
    if (declared === null) {
      fail(
        `authority-table.rows[row ${row.row}].standings`,
        `splits authority on ${field}, which declares no values`,
      )
    }
    const split = [...row.standings.authoritativeByValue.keys()]
    if (!sameSet(split, declared)) {
      // [SD §4.7.2b]: the qualifier is what makes propose / decide / rate THREE FACT KEYS. A split
      // that misses one leaves a fact key with no authority; a split that invents one gives
      // authority to a key no record can carry.
      fail(
        `authority-table.rows[row ${row.row}].standings.authoritativeByValue`,
        `splits on [${split.join(', ')}] where ${row.type}'s ${field} declares [${declared.join(', ')}]`,
      )
    }
  }

  return { canonicalSubjects, authority, reasons }
}

/* ───────────────────────────────  queries  ──────────────────────────────── */

/** The aggregate kinds a `type` may be asserted about, from the table rather than the types. */
export function admissibleSubjectKinds(
  tables: CanonicalSubjectTable,
  type: AssertionType,
): readonly AggregateKind[] {
  const row = tables.rows.get(type)
  if (row === undefined) return fail('canonical-subjects.rows', `${type} has no row`)
  const family = tables.families.get(row.family)
  if (family === undefined)
    return fail('canonical-subjects.families', `${row.family} is undeclared`)
  return family.members
}

/**
 * Every row whose authority is owed, in whole or in part.
 *
 * The count is the point. [SD §4.7] note 3 and [A8 §9 item 8] mean a large part of this table is a
 * declaration of what nobody has decided, and a reference model that cannot say *how much* is
 * undecided invites a reader to assume the answer is "not much".
 */
export function owedAuthorityRows(table: CanonicalSubjectTable): readonly CanonicalSubjectRow[] {
  return [...table.rows.values()].filter((row) => row.authority.status !== 'assigned')
}
