/**
 * Conformance — the shapes the boundary rules must REFUSE.
 *
 * Same contract as `core-vocabulary-refuses.ts`: every `@ts-expect-error` must fire. If an illegal
 * state ever becomes legal, TypeScript reports the directive as unused and this file stops
 * compiling.
 *
 * A type-level suite: nothing here runs. The behavioural half — that the verdicts come out the way
 * [SD §4.6.3] and [SD §5.2] say — is `boundary-rules.test.ts`.
 */
import {
  eventId,
  instant,
  partyId,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  inboundMessageRef,
  ruleRef,
  type AttemptedResolution,
  type CaptureFacts,
  type CaptureRejection,
  type CaptureVerdict,
  type DeclaredDerivedType,
  type GeofenceEligibleType,
  type NotificationObligation,
  type PossessionChangingType,
  type RephrasedSubmission,
  type ResolvedCapture,
  type RetainedSubmission,
  type Submission,
} from '../../src/index'

const S = subjectRef('shipment', shipmentId('S'))
const T = subjectRef('stop', stopId('9'))
const agent = { party: partyId('da'), role: 'destinationAgent' } as const
const said = instant('2026-03-04T15:20:00Z')
const spec = specVersion('1')
const msg = inboundMessageRef('inbound')
const R = ruleRef('R-SUBJECT-ARRIVAL', '1.0.0')

// 1. [SD §4.6.2] a submission has not been admitted, so it "acquires no eventId"
const s1: Submission<'arrival'> = {
  type: 'arrival',
  namedSubject: S,
  assertedBy: agent,
  assertedAt: said,
  specVersion: spec,
  inboundMessage: msg,
  capturedBy: 'KEYED_BY_PERSON',
  // @ts-expect-error the property is the error: a Submission has no eventId
  eventId: eventId('e'),
}
void s1

// 2. nor a recordedAt — it is server-authored and this record has not reached a server [SD §1.1]
const s2: Submission<'arrival'> = {
  type: 'arrival',
  namedSubject: S,
  assertedBy: agent,
  assertedAt: said,
  specVersion: spec,
  inboundMessage: msg,
  capturedBy: 'KEYED_BY_PERSON',
  // @ts-expect-error the property is the error: a Submission has no recordedAt
  recordedAt: instant('2026-03-04T15:21:00Z'),
}
void s2

// @ts-expect-error 3. [SD §4.6.2] a re-phrased claim is PARTNER_ASSERTED or KEYED_BY_PERSON, never a device
const c1: ResolvedCapture = 'DEVICE_GEOFENCE'
void c1

// 4. [SD §4.6.2] the re-phrased record's subject is the CANONICAL one; arrival's family is `stop`
const r1: RephrasedSubmission<'arrival'> = {
  type: 'arrival',
  // @ts-expect-error the subject is the error: a shipment is outside arrival's declared family
  subject: S,
  context: [S],
  evidence: [{ kind: 'inboundMessage', ref: msg }],
  assertedBy: agent,
  assertedAt: said,
  capturedBy: 'KEYED_BY_PERSON',
  specVersion: spec,
  resolvedBy: R,
}
void r1

// 5. [SD §4.6.2] "the subject the party actually named goes in context[]" — so context is never empty
const r2: RephrasedSubmission<'arrival'> = {
  type: 'arrival',
  subject: T,
  // @ts-expect-error the property is the error: `[]` is not a NonEmptyArray<SubjectRef>
  context: [],
  evidence: [{ kind: 'inboundMessage', ref: msg }],
  assertedBy: agent,
  assertedAt: said,
  capturedBy: 'KEYED_BY_PERSON',
  specVersion: spec,
  resolvedBy: R,
}
void r2

// 6. [SD §4.6.2] "the inbound message goes in evidence[]" — likewise never empty
const r3: RephrasedSubmission<'arrival'> = {
  type: 'arrival',
  subject: T,
  context: [S],
  // @ts-expect-error the property is the error: `[]` is not a NonEmptyArray<BoundaryEvidenceRef>
  evidence: [],
  assertedBy: agent,
  assertedAt: said,
  capturedBy: 'KEYED_BY_PERSON',
  specVersion: spec,
  resolvedBy: R,
}
void r3

// 7. a candidate set for `arrival` may only hold members of arrival's declared family
const at1: AttemptedResolution<'arrival'> = {
  rule: R,
  // @ts-expect-error the candidate is the error: a shipment is outside arrival's declared family
  candidates: [S],
  capturedBy: 'KEYED_BY_PERSON',
}
void at1

// 8. [SD §4.6.3] step 4: a retained claim never enters a contest, so it has no eventId to be named by
const ret1: RetainedSubmission<'arrival'> = {
  rule: 'E-CANON-OBLIGATION',
  retainedOutsideTheCatalog: true,
  inboundMessage: msg,
  claimed: { type: 'arrival', subject: S },
  attempted: null,
  refusal: {
    rule: 'E-CANON-STRICT',
    admitted: false,
    code: 'SUBJECT_OUTSIDE_DECLARED_FAMILY',
    type: 'arrival',
    named: 'shipment',
    declaredFamily: 'stop',
    members: ['stop', 'externallyPerformedLeg'],
  },
  obligation: {
    kind: 'NOTIFICATION',
    owedTo: agent,
    mustSupply: 'A_SUBJECT_IN_THE_DECLARED_FAMILY',
    declaredFamily: 'stop',
    members: ['stop'],
    target: {
      owed: 'notificationTarget',
      owedTo: 'A8 §9 item 6 — the party as a notification target',
    },
  },
  // @ts-expect-error the property is the error: a RetainedSubmission has no eventId
  eventId: eventId('e'),
}
void ret1

// @ts-expect-error 9. [SD §4.7.3] the notification target is OWED; an obligation may not invent a recipient field
const ob1: NotificationObligation = {
  kind: 'NOTIFICATION',
  owedTo: agent,
  mustSupply: 'A_SUBJECT_IN_THE_DECLARED_FAMILY',
  declaredFamily: 'stop',
  members: ['stop'],
}
void ob1

// @ts-expect-error 10. [SD §5.2] M2's list is acts and only acts; `arrival` is a time fact about a visit [SD §4.7.1]
const p1: PossessionChangingType = 'arrival'
void p1

// @ts-expect-error 11. [SD §5.2] M5 lets a geofence assert arrive and depart — never an act on M2's list
const g1: GeofenceEligibleType = 'delivery'
void g1

// @ts-expect-error 12. [SD §5.2] M4 declares exactly one derived class, and it is not the store-in act [SD §5.3]
const d1: DeclaredDerivedType = 'storeIn'
void d1

// 13. a rejection pairs one rule with its own codes; M1 does not issue M2's
const rj1: CaptureRejection = {
  rule: 'M1',
  code: 'POSSESSION_CHANGING_NEEDS_HUMAN_OR_PARTNER',
  type: 'delivery',
  // @ts-expect-error the property is the error: M1's rejection is the ASSUMED_FROM_PLAN cell only
  capturedBy: 'DEVICE_GEOFENCE',
}
void rj1

// 14. an admission says on what basis it was licensed; "M1 did not object" is not a licence
const v1: CaptureVerdict<'arrival'> = {
  verdict: 'ADMITTED',
  type: 'arrival',
  capturedBy: 'DEVICE_GEOFENCE',
  // @ts-expect-error the property is the error: M1 is not one of the licensing rules
  licensedBy: 'M1',
}
void v1

// @ts-expect-error 15. reasonCount is not optional — [SD §2.3] invariant 2 is counted, never assumed
const f1: CaptureFacts<'delivery'> = {
  type: 'delivery',
  basis: 'ACTUAL',
  capturedBy: 'KEYED_BY_PERSON',
}
void f1

// 16. M4 requires the inputs' eventIds as well as the rule — a derivation naming no input is not one
const f2: CaptureFacts<'sitEntryDate'> = {
  type: 'sitEntryDate',
  basis: 'ACTUAL',
  capturedBy: 'DERIVED_BY_RULE',
  reasonCount: 0,
  // @ts-expect-error the property is the error: `inputs: []` is not a NonEmptyArray<EventId>
  derivation: { rule: R, inputs: [] },
}
void f2
