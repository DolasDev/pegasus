/**
 * The envelope — [SD §1].
 *
 * > "Every record the catalog publishes carries one envelope. `subject` is a single typed
 * > reference to any one aggregate — never a path, never shipment-rooted. Records that are _also_
 * > about other aggregates say so in a separate, explicitly non-authoritative `context[]`."
 * > — [SD §1]
 *
 * This is the item [round-2-critique] named "the only genuinely unrecoverable item", so the
 * prohibitions in [SD §1.1] are encoded here wherever a type can hold them rather than described.
 */

import type { AggregateId, AggregateKind, PartyId } from './ids'
import type { Brand, Instant } from './primitives'
import type { RecordType } from './vocabulary'

/** [SD §1.1] "our id, globally unique, never reused"; distinct on a correction (see [SD §6.4]). */
export type EventId = Brand<string, 'eventId'>

export function eventId(raw: string): EventId {
  if (raw.length === 0) throw new RangeError('empty eventId')
  return raw as EventId
}

/** [SD §1.1] "the catalog vocabulary version this record was minted under". */
export type SpecVersion = Brand<string, 'specVersion'>

export function specVersion(raw: string): SpecVersion {
  if (raw.length === 0) throw new RangeError('empty specVersion')
  return raw as SpecVersion
}

/**
 * [SD §1.2] `SubjectRef { aggregate, id }`.
 *
 * Distributive over the kind parameter, so `SubjectRef<'stop' | 'externallyPerformedLeg'>` is a
 * union of two correctly-paired references rather than a product of two loose fields. That is
 * what makes E-CANON ([SD §4.3], [SD §4.6.2]) a compile-time check for a statically-known type.
 */
export type SubjectRef<K extends AggregateKind = AggregateKind> = K extends AggregateKind
  ? { readonly aggregate: K; readonly id: AggregateId<K> }
  : never

/**
 * `NoInfer` on the id is load-bearing: without it the kind is inferred from *both* arguments, so
 * `subjectRef('stop', shipmentId('S1'))` would widen K to `'stop' | 'shipment'` and compile. The
 * aggregate names the kind; the id must then match it.
 */
export function subjectRef<K extends AggregateKind>(
  aggregate: K,
  id: NoInfer<AggregateId<K>>,
): SubjectRef<K> {
  return { aggregate, id } as SubjectRef<K>
}

/**
 * [SD §5.1] `capturedBy` — seven members, "retained… carried forward unchanged".
 *
 * The machine-assertion rules ([SD §5.2] M1-M7) bind on this value, not on "a device": M1 forbids
 * `ASSUMED_FROM_PLAN` at `basis = ACTUAL`, M5 lets a geofence assert arrive and depart, and M7
 * declares eligibility per record `type`.
 *
 * TODO(capture rules): M1-M7 are predicates over (type, basis, capturedBy, outcome) and belong to
 * a capture-rules module built on these types, not here.
 */
export const CAPTURE_METHODS = [
  'OBSERVED_BY_PERSON',
  'KEYED_BY_PERSON',
  'DEVICE_GEOFENCE',
  'DEVICE_TELEMETRY',
  'PARTNER_ASSERTED',
  'DERIVED_BY_RULE',
  'ASSUMED_FROM_PLAN',
] as const

export type CaptureMethod = (typeof CAPTURE_METHODS)[number]

/**
 * The role vocabulary — [A8 §2].
 *
 * `src:sirva-ade`'s cast, plus the four roles A8 adds because they assert facts and ADE has no
 * slot for them (`customer`, `accountParty`, `weighMaster`, `platform`).
 *
 * Spelled lower-camel per **Rule A8-NAME-1**: "the bare word `agent` is not a role in this model.
 * Every agent role is spelled with its function (`originAgent`, `destinationAgent`, `loadAgent`,
 * `unloadAgent`, `sitAgent`, `r19Agent`, `rr19Agent`)." A8 §2 also quotes ADE's own capitalised
 * spellings (`OriginAgent`, …); the rule wins over the citation, and the rest of the cast is
 * spelled to match it.
 *
 * **Provisional.** [A8 §9 item 2] leaves the role enum undefined, and [A8 §2] records that
 * `src:stedi-x12-reference` element 98's code list "was not read". An authority module may
 * refine this; it may not quietly widen it.
 */
export const ROLE_NAMES = [
  'booker',
  'originAgent',
  'destinationAgent',
  'loadAgent',
  'unloadAgent',
  'hauler',
  'r19Agent',
  'rr19Agent',
  'sitAgent',
  'driver',
  'packer',
  'portHandler',
  'settlingAgent',
  'setoffAgent',
  // Added by [A8 §2] because each asserts facts:
  'customer', // = `goodsOwner` at the residence, per A8-NAME-2's two-way split of "shipper"
  'accountParty', // A8-NAME-2: the party that contracts and pays
  'weighMaster',
  'platform', // us; asserts `FactResolved` and every `DERIVED_BY_RULE` value
] as const

export type RoleName = (typeof ROLE_NAMES)[number]

/**
 * [SD §1.1] "`assertedBy` `{partyRef, role}` — **role rides on the assertion, not the party**."
 *
 * Corroborated by [A8 §3(a)]: "our A8 model should make role an attribute of the _assignment_,
 * never of the party", and by the GSD p.17 sample where one company holds two roles at once.
 */
export interface AssertedBy {
  readonly party: PartyId
  readonly role: RoleName
}

/**
 * The permanent prohibitions of [SD §1.1], encoded where a type can hold them.
 *
 * Every member is optional-`never`, so a record that supplies the field fails to compile while a
 * record that omits it is unaffected. Four of the six are quoted prohibitions; the two spellings
 * `subjects`/`subjectPath` are the same prohibition under the two names it would arrive under.
 */
interface ForbiddenOnEnvelope {
  /** [SD §1.1] "A second `subject`. One record, one subject". */
  readonly subjects?: never
  readonly secondSubject?: never
  /** [SD §1.1] "A subject _path_ (`shipment/…/stop/…`)". Also blocked in the id constructors. */
  readonly subjectPath?: never
  /** [SD §1.1] "A second classification axis"; [SD §1.3] `factClass` SUBSUMES `type`. */
  readonly factClass?: never
  /** [SD §1.1] "A tense qualifier. Tense lives on the time _value_ as `basis`" ([SD §4.2]). */
  readonly tense?: never
  /** DCSA's spelling of the same thing — [SD §1.3] takes DCSA's constraint mechanism, not its
   * two-axis shape: "DCSA does carry event type and classifier as two axes — we do not." */
  readonly eventClassifierCode?: never
  /** [SD §1.1] "A mutable current-state field. The catalog publishes assertions; state is a
   * projection." Also why [SD §4.5] forbids Alvys's `StopStatusChanged`. */
  readonly status?: never
  readonly currentState?: never
  /** [SD §1.1] revision 3 defect C: "A generic `correlation` link bag… **the typed per-class
   * fields win and the bag is deleted**" — `Assertion.supersedes`, `Correction.corrects`,
   * `FactResolved.selected`/`considered[]`, and `evidence[]` for the evidentiary case. */
  readonly correlation?: never
  readonly causedBy?: never
}

/**
 * The seven mandatory fields of [SD §1.1], minus `recordedAt`.
 *
 * `K` is the subject's aggregate kind. Assertions bind it to their type's declared canonical
 * subject family ([SD §4.7]); meta-records bind it to the subject of the fact they are about
 * ([SD §1.3] item 4).
 */
export interface EnvelopeCore<
  T extends RecordType,
  K extends AggregateKind = AggregateKind,
> extends ForbiddenOnEnvelope {
  readonly eventId: EventId
  /** [SD §1.1] "The **single** classification axis. On an Assertion this value **is** the fact
   * class. Names the act or fact, never the outcome" — [SD §1.3] E-TYPE, [SD §2.5] A-TYPE. */
  readonly type: T
  readonly specVersion: SpecVersion
  /** [SD §1.1] "The one aggregate this record asserts about… There is no second subject." */
  readonly subject: SubjectRef<K>
  readonly assertedBy: AssertedBy
  /** [SD §1.1] "The asserter's act of saying it." Never the occurrence clock ([SD §4.2]), and
   * never the clock authority is keyed on ([A8 §4.2] A8-INSTANT). */
  readonly assertedAt: Instant
  readonly capturedBy: CaptureMethod
  /**
   * [SD §1.4] "Other aggregates this record is also about. **Non-authoritative.**"
   *
   * Three rules make it safe, and two of them are structural here: a `SubjectRef` carries no
   * value, so rule 2 ("`context[]` never carries values") cannot be broken; and the fact key
   * ([SD §1.3]) is computed without it, so rule 3 ("not the resolution key") holds by
   * construction. Rule 1 ("never the subject") is a query-layer discipline — [SD §11] records it
   * as the one risk in §1 — and cannot be held by this type.
   */
  readonly context?: ReadonlyArray<SubjectRef>
}

/**
 * The capture face of the envelope — [SD §1.1]: `recordedAt` is "server-authored; **FORBIDDEN on
 * capture**".
 *
 * [SD §4.2] adopts the rule verbatim from `src:gs1-epcis-cbv`: `recordTime` "SHALL be ignored when
 * an event is presented to the Capture Interface, and SHALL be present when retrieved through the
 * Query Interfaces". One field with two opposite obligations is two types, not one optional
 * field — an optional field would make the forbidden case indistinguishable from a caller that
 * simply did not fill it in.
 */
export type CapturedEnvelope<
  T extends RecordType,
  K extends AggregateKind = AggregateKind,
> = EnvelopeCore<T, K> & { readonly recordedAt?: never }

/** The query face — [SD §1.1]: `recordedAt` is MANDATORY on query. */
export type QueriedEnvelope<
  T extends RecordType,
  K extends AggregateKind = AggregateKind,
> = EnvelopeCore<T, K> & { readonly recordedAt: Instant }

/** Either face. Use the specific one wherever the direction is known. */
export type Envelope<T extends RecordType, K extends AggregateKind = AggregateKind> =
  CapturedEnvelope<T, K> | QueriedEnvelope<T, K>

/** [SD §1.1] `recordedAt` is server-authored: the query face is minted from the capture face. */
export function recordOnQuery<T extends RecordType, K extends AggregateKind>(
  captured: CapturedEnvelope<T, K>,
  recordedAt: Instant,
): QueriedEnvelope<T, K> {
  const { recordedAt: _forbidden, ...rest } = captured
  return { ...rest, recordedAt } as QueriedEnvelope<T, K>
}

/**
 * [SD §1.4] rule 1: "A consumer filtering by subject MUST NOT be served context matches by
 * default. If it were, the shipment-rooted envelope would reappear as a query default."
 *
 * The rule is about a query default, so the type system cannot hold it. This predicate is the
 * check a query layer is measured against: subject matching never consults `context[]`.
 */
export function isAbout<K extends AggregateKind>(
  envelope: EnvelopeCore<RecordType, AggregateKind>,
  subject: SubjectRef<K>,
): boolean {
  return envelope.subject.aggregate === subject.aggregate && envelope.subject.id === subject.id
}

/** The non-authoritative half, asked for explicitly — never folded into {@link isAbout}. */
export function mentions<K extends AggregateKind>(
  envelope: EnvelopeCore<RecordType, AggregateKind>,
  subject: SubjectRef<K>,
): boolean {
  return (envelope.context ?? []).some(
    (ref) => ref.aggregate === subject.aggregate && ref.id === subject.id,
  )
}
