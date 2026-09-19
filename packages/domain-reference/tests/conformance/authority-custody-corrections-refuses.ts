/**
 * Conformance — the shapes authority, custody and corrections must REFUSE.
 *
 * Every `@ts-expect-error` must fire. If an illegal state becomes legal, TypeScript reports the
 * directive as unused and this file fails to compile. A type-level suite: nothing here runs, except
 * the one `throw` that narrows a discriminated union, which is also the demonstration of the only
 * legal way to obtain a {@link FactInstant}.
 */
import {
  eventId,
  instant,
  instantTheFactIsAbout,
  partyId,
  partyRoleId,
  ruleRef,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  R_WEIGHT_LOWER,
  type AuthorityClaim,
  type AuthorityRule,
  type CapturedAssertion,
  type CorrectionAttempt,
  type CorrectionReason,
  type CustodyBasis,
  type CustodyInterval,
  type FactInstant,
  type OffsettingRecord,
  type Standing,
} from '../../src/index'

const S = subjectRef('shipment', shipmentId('S1'))
const T = subjectRef('stop', stopId('T2'))
const P = partyId('p1')
const E = eventId('e1')
const I = instant('2026-03-01T09:00:00Z')
const head = {
  eventId: E,
  specVersion: specVersion('1'),
  assertedBy: { party: P, role: 'driver' },
  assertedAt: instant('2026-03-01T10:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
} as const

/* -- A8-INSTANT: authority is keyed on the instant the fact is ABOUT ------------------------- */

const arrival: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: I },
}
const about = instantTheFactIsAbout(arrival)
if (!about.resolved) throw new Error('an arrival value carries the instant it describes')
const AT: FactInstant = about.at

// 1. [A8 §4.2] A8-INSTANT: a wire instant — `assertedAt`, `recordedAt`, "now" — is not the instant
//    the fact is about, and there is deliberately no constructor that makes one out of it.
// @ts-expect-error A8-INSTANT: the wrong clock
const bad1: FactInstant = instant('2026-03-01T10:00:00Z')
void bad1

/* -- The custody basis rides on the handover act and on no other ----------------------------- */

// 2. [A8 §7.1]: `custodyBasis` is the handover's. A8-MOVE is defined on it, so a second act able to
//    carry it would be a second place authority could move from.
const bad2: CapturedAssertion<'loading'> = {
  ...head,
  type: 'loading',
  subject: S,
  basis: 'ACTUAL',
  // @ts-expect-error custodyBasis belongs to the handover act
  value: { occurredAt: I, outcome: 'COMPLETED', custodyBasis: 349 },
}
void bad2

// 3. …and a handover without one cannot be published at all: the fold would have no hinge.
const bad3: CapturedAssertion<'handover'> = {
  ...head,
  type: 'handover',
  subject: S,
  basis: 'ACTUAL',
  // @ts-expect-error a handover with no custody basis has no hinge
  value: { occurredAt: I, outcome: 'COMPLETED' },
}
void bad3

// 4. `src:uncefact-rec24` publishes two codes. A third is a new source, not a new value.
// @ts-expect-error Rec 24 publishes two codes
const bad4: CustodyBasis = 200
void bad4

/* -- Custody is a projection, never a record ------------------------------------------------- */

// 5. [SD §4.8]: "never stored, never asserted and never corrected" — so the fold's answer carries
//    no envelope, and cannot be round-tripped through the capture interface as one.
const bad5: CustodyInterval = {
  custody: 'KNOWN',
  holder: { kind: 'partyRole', partyRole: subjectRef('partyRole', partyRoleId('r1')) },
  basis: 349,
  since: I,
  evidencedBy: [E],
  rule: ruleRef('CUSTODY-AT', '1'),
  // @ts-expect-error custody is a projection, not a record
  eventId: E,
}
void bad5

/* -- A8-NAMED: no silent recency ------------------------------------------------------------- */

// 6. [A8 §4.4]: where `authoritative` is empty or plural, a tie-break rule is MANDATORY. Omitting
//    it is how "latest wins" comes back in through an unpopulated table.
// @ts-expect-error A8-NAMED: an empty authority needs a named tie-break
const bad6: AuthorityRule<'weight.net'> = {
  a8Row: 6,
  type: 'weight.net',
  rule: R_WEIGHT_LOWER,
  boundBy: 'NONE',
  authoritative: { kind: 'none', settledBy: { kind: 'valueRule', rule: R_WEIGHT_LOWER } },
}
void bad6

/* -- Standings, and what is not one ---------------------------------------------------------- */

// 7. [A8 §1]: authority "changes which assertion **wins**, never whether one may be made", and
//    [A8 §7.4] keeps a former holder's assertions. There is no standing meaning "suppressed".
// @ts-expect-error there is no suppressed standing
const bad7: Standing = 'suppressed'
void bad7

// 8. [A8 §8]: `Correction.authority` is satisfied by a role OR an instrument — "never by neither".
// @ts-expect-error a role or an instrument, never neither
const bad8: AuthorityClaim = { kind: 'none' }
void bad8

/* -- Corrections ----------------------------------------------------------------------------- */

// 9. [SD §6.3]: financial facts are corrected ONLY by an offsetting record. A `Correction` naming
//    `charge` does not typecheck, so the rule cannot be forgotten.
// @ts-expect-error financial facts take an offsetting record
const bad9: CorrectionAttempt<'charge'> = {
  corrects: E,
  type: 'charge',
  reason: { errorReason: 'INCORRECT_DATA' },
  authority: { kind: 'role', role: 'accountParty' },
  declaredBy: P,
  at: AT,
}
void bad9

// 10. [SD §6.4]: the 858's restore-to-previous is kept as an intent and dropped as a MECHANISM —
//     "applied across parties it silently promotes some other company's assertion".
const bad10: CorrectionAttempt = {
  corrects: E,
  type: 'delivery',
  reason: { errorReason: 'DID_NOT_OCCUR' },
  authority: { kind: 'role', role: 'destinationAgent' },
  declaredBy: P,
  at: AT,
  // @ts-expect-error restore-to-previous is dropped as a mechanism
  restoresPrevious: E,
}
void bad10

// 11. [SD §6.4] / EPCIS: a `DID_NOT_OCCUR` retraction names no replacement.
// @ts-expect-error a retraction names no replacement
const bad11: CorrectionReason = { errorReason: 'DID_NOT_OCCUR', replacement: E }
void bad11

// 12. `src:sirva-ade` ABS p.3: `ORIGINAL` is the thing being offset, not an offset.
// @ts-expect-error ORIGINAL is the thing offset, not an offset
const bad12: OffsettingRecord = { offsets: E, adjCode: 'ORIGINAL', narrative: 'refund' }
void bad12
