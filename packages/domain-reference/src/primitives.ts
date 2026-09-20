/**
 * Primitives the rest of the vocabulary is built from.
 *
 * Nothing in this module is a domain decision. It exists so that the modules that DO carry
 * decisions can spend their citations on the decision rather than on plumbing. The one thing
 * here that is load-bearing is `Owed`: the documents mark some content **owed**, and
 * [SD §0] ("Disclosure") forbids guessing a value to make the types tidy. `Owed` is how a
 * shape says "the binding layer has not fixed this" in a way a compiler can see.
 */

/**
 * Nominal typing. Two branded aliases over the same carrier are mutually unassignable, which is
 * what makes a shipment id fail to compile where a stop id is wanted.
 */
export type Brand<Carrier, Tag extends string> = Carrier & { readonly __brand: Tag }

/** An instant on the wire. ISO-8601 with an offset. */
export type Instant = Brand<string, 'Instant'>

/**
 * A calendar date, which is NOT an instant.
 *
 * [SD §5.3] `sitEntryDate` is "a **date**: when storage starts counting" while `storeIn` is an act
 * with an occurrence instant. The tariff forbids substituting one for the other (400NG Item 29.6 /
 * 17.20), so the two must not share a type.
 */
export type CalendarDate = Brand<string, 'CalendarDate'>

export function instant(raw: string): Instant {
  if (Number.isNaN(Date.parse(raw))) {
    throw new RangeError(`not an instant: ${JSON.stringify(raw)}`)
  }
  return raw as Instant
}

export function calendarDate(raw: string): CalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RangeError(`not a calendar date (YYYY-MM-DD): ${JSON.stringify(raw)}`)
  }
  return raw as CalendarDate
}

/**
 * A list a rule requires at least one member of.
 *
 * [SD §2.3] invariant 2 ("`reasons[]` has at least one member unless `outcome = COMPLETED`") and
 * [SD §4.3] (`considered[]` names every assertion in the contest) are both statable in the type
 * rather than in a comment, and this is what states them.
 */
export type NonEmptyArray<T> = readonly [T, ...T[]]

/** Exhaustiveness. A `switch` that stops covering its union stops compiling. */
export function assertNever(impossible: never, context = 'unreachable'): never {
  throw new Error(`${context}: ${JSON.stringify(impossible)}`)
}

/**
 * A compile-time assertion that two unions are the same set. Used to make a hand-written table
 * fail to compile when the vocabulary it is keyed on gains or loses a member — the mechanism
 * [SD §4.7]'s "complete declaration" claim needs if it is to stay true.
 */
export type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

/**
 * Content the binding documents declare to exist and do not fix.
 *
 * [SD §0]: "where a source supports only part of a rule, the supported part and the authored part
 * are separated"; the disclosure rule's companion is that an unfixed shape is represented as
 * unfixed. `owedTo` names the document or area that owes it, so the gap is queryable rather than
 * silently defaulted.
 */
export interface Owed<Name extends string, Owner extends string> {
  readonly owed: Name
  readonly owedTo: Owner
  /** Never normative. A provisional payload may be carried so scenarios can be written. */
  readonly provisional?: unknown
}

export function owed<Name extends string, Owner extends string>(
  name: Name,
  owedTo: Owner,
  provisional?: unknown,
): Owed<Name, Owner> {
  return provisional === undefined ? { owed: name, owedTo } : { owed: name, owedTo, provisional }
}

/**
 * A member of a code list the documents require to exist but do not publish — the reason
 * vocabulary ([SD §2.4]: "the list itself is A4's job"), the role-class vocabulary, the identity
 * scheme vocabulary, units of measure.
 *
 * It is branded per vocabulary so a reason code cannot be passed where a scheme name is wanted,
 * and it is constructed through a named function so that every literal in a scenario is visibly a
 * placeholder rather than a published member.
 */
export type OwedCode<Vocabulary extends string> = Brand<string, `owedCode:${Vocabulary}`>

/**
 * Key-order-independent serialisation, for comparing the `qualifier` half of a fact key.
 *
 * [SD §1.3] makes `factRef = (subject, type, qualifier?)` the key competing assertions pair on, so
 * two records that differ only in the order their qualifier's fields were written must land in
 * the same contest. `JSON.stringify` alone would put them in two.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`)
  return `{${entries.join(',')}}`
}

export function owedCode<Vocabulary extends string>(
  vocabulary: Vocabulary,
  code: string,
): OwedCode<Vocabulary> {
  if (code.length === 0) {
    throw new RangeError(`empty ${vocabulary} code`)
  }
  return code as OwedCode<Vocabulary>
}
