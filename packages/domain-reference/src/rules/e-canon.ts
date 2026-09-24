/**
 * Subject admission — [SD §4.6], "**reject, never re-key**", in all three of its parts.
 *
 * > "The boundary is structural and it refuses. A record whose `subject` kind is not in the
 * > canonical subject family declared for its `type` is rejected — never filed under the subject it
 * > named, and never re-keyed by the boundary onto a subject it did not name. Re-phrasing a claim
 * > onto its canonical subject is an **ingest-side act**, performed before the boundary, by a
 * > **named, versioned subject-resolution rule** that must return **exactly one** candidate. A
 * > rejection is not a silence: the inbound message, the rule attempted, the candidate set and the
 * > refusal are retained, and an obligation is emitted to the asserting party." — [SD §4.6]
 *
 * The three rules sit at three different places and this module keeps them apart, because that
 * separation is the decision: E-CANON-RESOLVE runs **before** the boundary, E-CANON-STRICT **is**
 * the boundary, and E-CANON-OBLIGATION governs what is kept **outside** it.
 *
 * **[ORIGINAL]** as a decision ([SD §4.6.1]): reasons (a) and (c) are the shared layer's own
 * settled text (M1 and [SD §7.4]) and (b) is `src:shippeo`'s published matching policy read one
 * level up. "No source in the corpus states a subject-admission rule, because no source in the
 * corpus carries a declared canonical subject per record type."
 *
 * Nothing here throws. Every entry point returns a typed verdict, because a refusal is a published
 * outcome of this model and not an exceptional condition of a program.
 */

import type { EvidenceRef, RuleRef } from '../assertions'
import type { AssertedBy, CaptureMethod, SpecVersion, SubjectRef } from '../envelope'
import { subjectRef } from '../envelope'
import type { AggregateKind } from '../ids'
import { shipmentId, stopId, partyId } from '../ids'
import type { Brand, Instant, NonEmptyArray, Owed } from '../primitives'
import { instant, owed } from '../primitives'
import type {
  AssertionType,
  CanonicalFamily,
  CanonicalSubjectKind,
  SubjectFamilyName,
} from '../vocabulary'
import { SUBJECT_FAMILIES, admitSubject } from '../vocabulary'

/* ------------------------------------------------------------------------------------------------
 * What arrives
 * ---------------------------------------------------------------------------------------------- */

/**
 * The inbound message, verbatim — [SD §4.6.2] E-CANON-OBLIGATION retains it, and E-CANON-RESOLVE
 * puts it in `evidence[]`.
 *
 * `EvidenceRef` is a `document` aggregate or an assertion `eventId`, and an inbound message is
 * demonstrably neither — it has not been admitted, so it has no `eventId`, and no document says an
 * inbound message is a `document`. Carried as its own opaque ref rather than widening `EvidenceRef`
 * on inference; the widening below is local to ingest.
 *
 * **[A6 §3.5(c)] ratified that rather than promoting it**, so this is the decision and no longer a
 * placeholder. `src:nmfta-ebol` — the one publisher that models both lodging a document and the
 * document — returns an **acceptance identifier distinct from the document identifier**, so a
 * submission and an instrument are different facts where anyone has modelled both. The only argument
 * the other way is `src:stedi-x12-reference`'s "the document *is* the message", an observation about
 * an encoding in an area its own analysis scores `1` on C1. And the asymmetry is decisive:
 * ratifying costs no published byte, widening `EvidenceRef` costs every consumer a re-validation.
 *
 * **The consequence, stated rather than implied.** The link from an admitted Assertion back to the
 * message that carried it does *not* survive the boundary in `evidence[]`. It survives here, on
 * {@link RetainedSubmission}, which E-CANON-OBLIGATION already requires to retain the message
 * verbatim. [SD §4.6.2]'s "the inbound message goes in `evidence[]`" is therefore true on the
 * boundary side, and [A6 §Cross-area] records the narrowing against [SD].
 */
export type InboundMessageRef = Brand<string, 'inboundMessage'>

export function inboundMessageRef(raw: string): InboundMessageRef {
  if (raw.length === 0) throw new RangeError('empty inbound message ref')
  return raw as InboundMessageRef
}

/** `evidence[]` as ingest may spell it, which is [SD §4.1]'s union plus the unadmitted message. */
export type BoundaryEvidenceRef =
  EvidenceRef | { readonly kind: 'inboundMessage'; readonly ref: InboundMessageRef }

/**
 * A claim as it arrives, **before** the boundary.
 *
 * [SD §4.6.2] E-CANON-STRICT: a record that is not admitted "acquires no `eventId`, is filed under
 * no fact key, and enters no contest". So nothing this side of the boundary may carry either —
 * `eventId` and `recordedAt` are optional-`never` for the same reason `CapturedEnvelope` forbids
 * `recordedAt` ([SD §1.1]): the field's absence has to be a compile-time fact, not a convention.
 *
 * `namedSubject` is deliberately a bare `SubjectRef` over the whole aggregate enum. It is the
 * subject the claiming party *named*, which is exactly the value that may be outside the family.
 */
export interface Submission<T extends AssertionType = AssertionType> {
  readonly type: T
  readonly namedSubject: SubjectRef
  /** [SD §4.6.2] "`assertedBy` and `assertedAt` remain the claiming party's." */
  readonly assertedBy: AssertedBy
  readonly assertedAt: Instant
  readonly specVersion: SpecVersion
  readonly inboundMessage: InboundMessageRef
  readonly capturedBy: CaptureMethod
  readonly eventId?: never
  readonly recordedAt?: never
}

/* ------------------------------------------------------------------------------------------------
 * E-CANON-STRICT — the boundary
 * ---------------------------------------------------------------------------------------------- */

/**
 * **Rule E-CANON-STRICT** — [SD §4.6.2].
 *
 * > "The admission check is purely structural: is `subject.aggregate` a member of the family
 * > declared for `type` at this `specVersion` (§4.7)? If not, the record is **not admitted to the
 * > catalog**. It acquires no `eventId`, is filed under no fact key, and enters no contest. The
 * > boundary performs no substitution, no nearest-match and no best-guess."
 *
 * The refusal arm carries `eventId?: never` and `factKey?: never` so that the three consequences
 * the rule states are held by the type rather than asserted in prose.
 */
export type SubjectAdmission<T extends AssertionType = AssertionType> =
  | {
      readonly rule: 'E-CANON-STRICT'
      readonly admitted: true
      readonly type: T
      readonly subject: SubjectRef<CanonicalSubjectKind<T>>
    }
  | {
      readonly rule: 'E-CANON-STRICT'
      readonly admitted: false
      readonly code: 'SUBJECT_OUTSIDE_DECLARED_FAMILY'
      readonly type: T
      /** The kind the party named — retained because the refusal must be explicable to them. */
      readonly named: AggregateKind
      readonly declaredFamily: CanonicalFamily<T>
      readonly members: readonly AggregateKind[]
      readonly eventId?: never
      readonly factKey?: never
    }

/**
 * The boundary check itself. Structural, total, and it performs no substitution — the `named` kind
 * travels into the refusal and never into a subject.
 *
 * Built on `admitSubject` in `vocabulary.ts` rather than re-deriving the family lookup: the
 * canonical-subject table is [SD §4.7]'s and "it outranks any per-document restatement", so a
 * second reading of it here would be a place for the two to drift.
 */
export function admitAtBoundary<T extends AssertionType>(
  submission: Submission<T>,
): SubjectAdmission<T> {
  const admission = admitSubject(submission.type, submission.namedSubject)
  if (admission.admitted) {
    return {
      rule: 'E-CANON-STRICT',
      admitted: true,
      type: admission.type,
      subject: admission.subject,
    }
  }
  return {
    rule: 'E-CANON-STRICT',
    admitted: false,
    code: 'SUBJECT_OUTSIDE_DECLARED_FAMILY',
    type: admission.type,
    named: admission.named,
    declaredFamily: admission.declaredFamily,
    members: admission.members,
  }
}

/* ------------------------------------------------------------------------------------------------
 * E-CANON-RESOLVE — before the boundary
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §4.6.2] E-CANON-RESOLVE: "`capturedBy` is `PARTNER_ASSERTED` (or `KEYED_BY_PERSON` where a
 * human operator supplied the missing subject)."
 *
 * Two members and not the whole enum: a re-phrased claim is by construction one a party made and a
 * person or a partner system re-expressed, so `DEVICE_*`, `DERIVED_BY_RULE` and `ASSUMED_FROM_PLAN`
 * have nobody to attribute it to. That is reason (a) of [SD §4.6.1] in the type — "a re-key is a
 * fact the boundary is not entitled to assert".
 */
export type ResolvedCapture = Extract<CaptureMethod, 'PARTNER_ASSERTED' | 'KEYED_BY_PERSON'>

/**
 * What a published, versioned subject-resolution rule returned.
 *
 * DECISION: the rule is modelled as *its output* — `{rule, candidates}` — rather than as a function
 * this module calls. [SD §4.6.2] fixes the rule's obligations (published, versioned, exactly one
 * candidate) and [SD §4.6.2] E-CANON-OBLIGATION requires "the resolution rule attempted, **and the
 * candidate set it returned**" to be retained, so the candidate set is a value the model must carry
 * either way. Taking it as input also keeps every function here pure and total.
 */
export interface AttemptedResolution<T extends AssertionType = AssertionType> {
  /** "`{ruleId, ruleVersion}`, the same shape as `FactResolved.rule`" — [SD §4.6.2]. */
  readonly rule: RuleRef
  readonly candidates: readonly SubjectRef<CanonicalSubjectKind<T>>[]
  readonly capturedBy: ResolvedCapture
}

/**
 * The claim after re-phrasing — [SD §4.6.2]: "**The claim is theirs; the resolution is ours; both
 * are visible on the record.**"
 *
 * Theirs: `assertedBy`, `assertedAt`, and the subject they named, kept in `context[]`. Ours: the
 * canonical `subject`, and `resolvedBy`.
 *
 * DECISION: [SD §4.6.2] names every field the resulting Assertion carries except a field for the
 * resolution rule, while requiring that the resolution be "visible on the record". `resolvedBy` is
 * this module's spelling for that half. Dropping it would leave the claim visible and the
 * resolution invisible, which is the one reading the sentence forbids.
 */
export interface RephrasedSubmission<T extends AssertionType = AssertionType> {
  readonly type: T
  readonly subject: SubjectRef<CanonicalSubjectKind<T>>
  /** [SD §4.6.2] "the subject the party actually named goes in `context[]`" — non-authoritative
   * ([SD §1.4]), which is what makes the re-phrasing disputable instead of invisible. */
  readonly context: NonEmptyArray<SubjectRef>
  /** [SD §4.6.2] "the inbound message goes in `evidence[]`". */
  readonly evidence: NonEmptyArray<BoundaryEvidenceRef>
  readonly assertedBy: AssertedBy
  /** [SD §4.6.3] step 5: "`assertedAt` = when _they_ said it (not when we resolved it)." */
  readonly assertedAt: Instant
  readonly capturedBy: ResolvedCapture
  readonly specVersion: SpecVersion
  readonly resolvedBy: RuleRef
  readonly eventId?: never
  readonly recordedAt?: never
}

/**
 * [SD §4.6.2]: "Where it yields zero or more than one, resolution **fails** and E-CANON-STRICT
 * applies."
 *
 * Two failure codes rather than one, because the obligation they emit differs in what the party
 * must supply — nothing matched at all, versus several matched and the party must choose. Both
 * fail; the split is diagnostic, not normative.
 */
export type ResolutionVerdict<T extends AssertionType = AssertionType> =
  | {
      readonly rule: 'E-CANON-RESOLVE'
      readonly resolved: true
      readonly submission: RephrasedSubmission<T>
    }
  | {
      readonly rule: 'E-CANON-RESOLVE'
      readonly resolved: false
      readonly code: 'ZERO_CANDIDATES' | 'AMBIGUOUS'
      readonly cardinality: number
      readonly candidates: readonly SubjectRef<CanonicalSubjectKind<T>>[]
      readonly attempted: RuleRef
    }

/**
 * E-CANON-RESOLVE, at its cardinality gate.
 *
 * [SD §4.6.3] step 2 is the whole of it: resolution "does not fall through to recency, to the later
 * stop, to the nearer geofence, or to the stop whose planned window contains the asserted time.
 * There is no tie-break here and **A8-NAMED's prohibition on implicit last-writer-wins has a
 * subject-side twin: there is no implicit nearest-subject-wins either.**"
 *
 * So there is exactly one branch that succeeds, and it is `length === 1`. Any ordering of the
 * candidate array is meaningless to this function by design.
 */
export function resolveSubject<T extends AssertionType>(
  submission: Submission<T>,
  attempted: AttemptedResolution<T>,
): ResolutionVerdict<T> {
  const { candidates } = attempted
  const only = candidates.length === 1 ? candidates[0] : undefined
  if (only === undefined) {
    return {
      rule: 'E-CANON-RESOLVE',
      resolved: false,
      code: candidates.length === 0 ? 'ZERO_CANDIDATES' : 'AMBIGUOUS',
      cardinality: candidates.length,
      candidates,
      attempted: attempted.rule,
    }
  }
  return {
    rule: 'E-CANON-RESOLVE',
    resolved: true,
    submission: {
      type: submission.type,
      subject: only,
      context: [submission.namedSubject],
      evidence: [{ kind: 'inboundMessage', ref: submission.inboundMessage }],
      assertedBy: submission.assertedBy,
      assertedAt: submission.assertedAt,
      capturedBy: attempted.capturedBy,
      specVersion: submission.specVersion,
      resolvedBy: attempted.rule,
    },
  }
}

/* ------------------------------------------------------------------------------------------------
 * E-CANON-OBLIGATION — outside the catalog
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §4.6.2] E-CANON-OBLIGATION: a rejection "emits a **notification obligation** to the asserting
 * party naming what it must supply. §6.5's obligation mechanism is extended to the boundary for
 * exactly this."
 */
export interface NotificationObligation {
  readonly kind: 'NOTIFICATION'
  /** "to the asserting party" — [SD §4.6.2]. The party, in the role they asserted under. */
  readonly owedTo: AssertedBy
  /** "naming what it must supply" — [SD §4.6.2]. */
  readonly mustSupply: 'A_SUBJECT_IN_THE_DECLARED_FAMILY'
  readonly declaredFamily: SubjectFamilyName
  readonly members: readonly AggregateKind[]
  /**
   * [SD §4.7.3]: "**The recipient has no field.** [A8 §9 item 6] owes 'the party as a notification
   * target', and [SD §6.5]'s obligations cannot name a contactable party until it lands."
   *
   * The obligation knows *whom* it is owed to (`owedTo`); it cannot say *how* they are reached.
   * Represented as owed rather than defaulted to an address shape nobody published.
   */
  readonly target: Owed<'notificationTarget', 'A8 §9 item 6 — the party as a notification target'>
}

/**
 * What a refusal leaves behind — [SD §4.6.2] E-CANON-OBLIGATION.
 *
 * > "A rejected submission is retained outside the catalog — the inbound message verbatim, the
 * > `type` and `subject` it named, the resolution rule attempted, the candidate set it returned,
 * > and the refusal — and emits a notification obligation… a rejected claim is never silently
 * > dropped."
 *
 * Three optional-`never` fields carry consequences the prose states:
 * - `eventId` / `factKey` — E-CANON-STRICT's "acquires no `eventId`, is filed under no fact key";
 * - `considered` — [SD §4.6.3] step 4, "the agent's claim is **not** in `considered[]`, because
 *   `considered[]` names every assertion **in the contest** and this one never entered it".
 */
export interface RetainedSubmission<T extends AssertionType = AssertionType> {
  readonly rule: 'E-CANON-OBLIGATION'
  readonly retainedOutsideTheCatalog: true
  readonly inboundMessage: InboundMessageRef
  readonly claimed: { readonly type: T; readonly subject: SubjectRef }
  /** `null` where no resolution rule was attempted at all — [SD §4.6.2] makes re-phrasing a MAY. */
  readonly attempted: AttemptedResolution<T> | null
  readonly refusal: Extract<SubjectAdmission<T>, { admitted: false }>
  readonly obligation: NotificationObligation
  readonly eventId?: never
  readonly factKey?: never
  readonly considered?: never
}

/**
 * [SD §4.6.3] step 4, held structurally rather than described: `FactResolved.considered` is
 * `NonEmptyArray<EventId>` and a retained submission has no `eventId` to put in one. A claim that
 * was refused cannot be named as a participant in the contest it never entered.
 */
type RetainedCannotEnterAContest = RetainedSubmission['eventId'] extends undefined ? true : never
const _retainedCannotEnterAContest: RetainedCannotEnterAContest = true
void _retainedCannotEnterAContest

export function retain<T extends AssertionType>(
  submission: Submission<T>,
  refusal: Extract<SubjectAdmission<T>, { admitted: false }>,
  attempted: AttemptedResolution<T> | null,
): RetainedSubmission<T> {
  return {
    rule: 'E-CANON-OBLIGATION',
    retainedOutsideTheCatalog: true,
    inboundMessage: submission.inboundMessage,
    claimed: { type: submission.type, subject: submission.namedSubject },
    attempted,
    refusal,
    obligation: {
      kind: 'NOTIFICATION',
      owedTo: submission.assertedBy,
      mustSupply: 'A_SUBJECT_IN_THE_DECLARED_FAMILY',
      // `CanonicalFamily<T>` stays deferred while `T` is a type parameter, so the compiler cannot
      // see that it is always a `SubjectFamilyName`. The table it is read from is keyed on exactly
      // that union ([SD §4.7]), so the cast narrows a value that is already correct by construction.
      declaredFamily: refusal.declaredFamily as SubjectFamilyName,
      members: SUBJECT_FAMILIES[refusal.declaredFamily as SubjectFamilyName],
      target: owed('notificationTarget', 'A8 §9 item 6 — the party as a notification target'),
    },
  }
}

/* ------------------------------------------------------------------------------------------------
 * The three, in the order they run
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §4.6.3]: "**the successful and the unsuccessful path produce the same kind of record, so the
 * model has one behaviour with a cardinality gate, not two behaviours.**"
 *
 * The three arms are the three places a claim can end up, and they are not three behaviours: the
 * first two differ only in whether ingest had to re-phrase, and they yield records "identical in
 * shape".
 */
export type IngestVerdict<T extends AssertionType = AssertionType> =
  | {
      readonly outcome: 'ADMITTED_AS_NAMED'
      readonly rule: 'E-CANON-STRICT'
      readonly submission: Submission<T>
      readonly subject: SubjectRef<CanonicalSubjectKind<T>>
    }
  | {
      readonly outcome: 'ADMITTED_AFTER_RESOLUTION'
      readonly rule: 'E-CANON-RESOLVE'
      readonly submission: RephrasedSubmission<T>
    }
  | {
      readonly outcome: 'RETAINED'
      readonly rule: 'E-CANON-OBLIGATION'
      readonly retained: RetainedSubmission<T>
    }

/**
 * Ingest, end to end, in the order [SD §4.6.2] puts the three rules in.
 *
 * Note what the order is **not**: resolution is not attempted first and admission second. A claim
 * already phrased on its canonical subject is admitted as it stands and is never re-phrased, which
 * is why `attempted` may be `null` for the overwhelming majority of traffic. Re-phrasing exists for
 * the claims that would otherwise be refused, and it runs before the boundary, never inside it.
 */
export function ingest<T extends AssertionType>(
  submission: Submission<T>,
  attempted: AttemptedResolution<T> | null = null,
): IngestVerdict<T> {
  const admission = admitAtBoundary(submission)
  if (admission.admitted) {
    return {
      outcome: 'ADMITTED_AS_NAMED',
      rule: 'E-CANON-STRICT',
      submission,
      subject: admission.subject,
    }
  }
  if (attempted === null) {
    return {
      outcome: 'RETAINED',
      rule: 'E-CANON-OBLIGATION',
      retained: retain(submission, admission, null),
    }
  }
  const resolution = resolveSubject(submission, attempted)
  if (resolution.resolved) {
    return {
      outcome: 'ADMITTED_AFTER_RESOLUTION',
      rule: 'E-CANON-RESOLVE',
      submission: resolution.submission,
    }
  }
  // [SD §4.6.2]: "Where it yields zero or more than one, resolution fails and E-CANON-STRICT
  // applies." The boundary has already refused; what is left is the obligation.
  return {
    outcome: 'RETAINED',
    rule: 'E-CANON-OBLIGATION',
    retained: retain(submission, admission, attempted),
  }
}

/* ------------------------------------------------------------------------------------------------
 * [SD §4.6.3] — the hard case, worked
 * ---------------------------------------------------------------------------------------------- */

/**
 * The scenario, verbatim from [SD §4.6.3]:
 *
 * > "_One trip. Shipment S is split-delivered: stop 4 takes the first portion, stop 9 the balance.
 * > The destination agent keys 'shipment S arrived' — `type = arrival`, `subject = shipment:S`, no
 * > stop named. The driver's app has already asserted arrival at both stops by geofence (permitted
 * > by M5)._"
 *
 * It is here rather than in a test because [SD §4.6.2] titles itself "stated so they are testable"
 * and [SD §4.6.3] is the case the blocker required: reason (c) of [SD §4.6.1] is that "re-key has
 * no defined behaviour at cardinality ≠ 1, and cardinality ≠ 1 is the normal HHG case."
 */
export const HARD_CASE_SHIPMENT_PHRASED_ARRIVAL = {
  shipment: subjectRef('shipment', shipmentId('S')),
  stop4: subjectRef('stop', stopId('4')),
  stop9: subjectRef('stop', stopId('9')),
  destinationAgent: { party: partyId('destination-agent'), role: 'destinationAgent' },
  /** [SD §4.6.3] step 5: "`assertedAt` = when _they_ said it (not when we resolved it)." */
  saidAt: instant('2026-03-04T15:20:00Z'),
} as const satisfies {
  shipment: SubjectRef<'shipment'>
  stop4: SubjectRef<'stop'>
  stop9: SubjectRef<'stop'>
  destinationAgent: AssertedBy
  saidAt: Instant
}

/** The agent's claim as submitted: `type = arrival`, `subject = shipment:S`, no stop named. */
export function hardCaseSubmission(specVersion: SpecVersion): Submission<'arrival'> {
  return {
    type: 'arrival',
    namedSubject: HARD_CASE_SHIPMENT_PHRASED_ARRIVAL.shipment,
    assertedBy: HARD_CASE_SHIPMENT_PHRASED_ARRIVAL.destinationAgent,
    assertedAt: HARD_CASE_SHIPMENT_PHRASED_ARRIVAL.saidAt,
    specVersion,
    inboundMessage: inboundMessageRef('agent-keyed: "shipment S arrived"'),
    capturedBy: 'KEYED_BY_PERSON',
  }
}

/**
 * The published subject-resolution rule for *a destination agent's shipment-phrased arrival*,
 * as it behaves on this trip and on a trip with one stop for S.
 *
 * [SD §4.6.3] step 2: on the split-delivered trip "it returns **two** candidates, stop 4 and
 * stop 9. **Resolution fails at cardinality.**" The one-candidate case is the contrast the section
 * closes with: "the record admitted is _identical in shape_ to step 5's."
 */
export function hardCaseAttempt(
  candidates: readonly SubjectRef<'stop' | 'externallyPerformedLeg'>[],
  rule: RuleRef,
): AttemptedResolution<'arrival'> {
  return { rule, candidates, capturedBy: 'KEYED_BY_PERSON' }
}

/**
 * Steps 1-3 and 5 of [SD §4.6.3], as verdicts. (Step 4 — the contest running without the claim —
 * is not a verdict of this module: it is `FactResolved` over `(stop:4, arrival)` and
 * `(stop:9, arrival)` under `AUTHORITATIVE-ROLE-AT-INSTANT` [A8 §5 row 1], and the claim's absence
 * from `considered[]` is already structural, above.)
 */
export function workHardCase(
  specVersion: SpecVersion,
  rule: RuleRef,
): {
  /** Steps 1-3: refused, resolution fails at two, submission retained with both candidates. */
  readonly twoCandidates: IngestVerdict<'arrival'>
  /** Step 5: the stop is supplied, a **new** Assertion is minted on `stop:9`. */
  readonly stopSupplied: IngestVerdict<'arrival'>
  /**
   * The contrast case, on a **different** trip: the van has exactly one stop for shipment S, so
   * step 2 succeeds first time and no obligation is ever emitted. [SD §4.6.3]: "the record admitted
   * is _identical in shape_ to step 5's — same `context[]`, same `evidence[]`, same `capturedBy`".
   * It has to be a different candidate stop for the comparison to mean anything: what the section
   * claims is one *shape*, not one record.
   */
  readonly oneCandidate: IngestVerdict<'arrival'>
} {
  const submission = hardCaseSubmission(specVersion)
  const { stop4, stop9 } = HARD_CASE_SHIPMENT_PHRASED_ARRIVAL
  return {
    twoCandidates: ingest(submission, hardCaseAttempt([stop4, stop9], rule)),
    stopSupplied: ingest(submission, hardCaseAttempt([stop9], rule)),
    oneCandidate: ingest(submission, hardCaseAttempt([stop4], rule)),
  }
}

/**
 * [SD §4.6.3]'s symmetric case, which the section insists is "just as common and is settled the
 * same way": "A driver's app naturally phrases _delivery_ against the stop it is standing at:
 * `type = delivery`, `subject = stop:T`. `delivery`'s family is `goods = {shipment, portion}`
 * (§4.7), so `stop` is not a member and the record is refused exactly as the agent's was."
 *
 * It is worth having both directions in the module, because the sentence they support is the one
 * that stops E-CANON being read as a partner-hygiene rule: "**E-CANON is not a rule about partners
 * being sloppy; both of our own first-party producers hit it, in opposite directions.**"
 */
export function symmetricCaseSubmission(
  specVersion: SpecVersion,
  stop: SubjectRef<'stop'>,
  driver: AssertedBy,
  at: Instant,
): Submission<'delivery'> {
  return {
    type: 'delivery',
    namedSubject: stop,
    assertedBy: driver,
    assertedAt: at,
    specVersion,
    inboundMessage: inboundMessageRef('driver app: delivery at the stop it is standing at'),
    capturedBy: 'KEYED_BY_PERSON',
  }
}
