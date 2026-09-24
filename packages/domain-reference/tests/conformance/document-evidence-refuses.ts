/**
 * Conformance — the shapes [A6 §3.5(c)]'s refusal must keep illegal.
 *
 * Same contract as `core-vocabulary-refuses.ts`: every `@ts-expect-error` must fire. If an illegal
 * state ever becomes legal, TypeScript reports the directive as unused and this file stops
 * compiling.
 *
 * **This file exists because the first draft of A6's tests did not hold the round's central
 * refusal.** It asserted `expect(kinds).not.toContain('inboundMessage')` over a hand-written array
 * and `expect(fixture.evidence).toBeUndefined()` over a fixture the test itself wrote — two
 * assertions that read nothing and can never fail, which is exactly the defect [A2 §9] named and
 * [A6 §9] generalised: **a recorded gap should be a gate wherever the gap has an edge the types can
 * see.** Widening `EvidenceRef` is such an edge, so the refusal belongs here and nowhere else.
 *
 * A type-level suite: nothing here runs. The behavioural half — that an ingest-side submission
 * carries the message and an admitted Assertion's published `evidence[]` does not — is
 * `tests/scenarios/one-arrival-two-asserters.test.ts`.
 */
import {
  eventId,
  documentId,
  inboundMessageRef,
  subjectRef,
  type BoundaryEvidenceRef,
  type EvidenceRef,
} from '../../src/index'

/* ------------------------------------------------------------------------------------------------
 * [A6 §3.5(c)] — the published union has two branches, and an inbound message is not one
 * ---------------------------------------------------------------------------------------------- */

/** Both legal branches, so a tamper that removes one is caught too. */
const aDocument: EvidenceRef = {
  kind: 'document',
  ref: subjectRef('document', documentId('DOC-BOL-6031')),
}
const anAssertion: EvidenceRef = { kind: 'assertion', ref: eventId('A-NET') }
void aDocument
void anAssertion

/**
 * The refusal, and the reason it is written as an assignment rather than as an annotated literal:
 * `@ts-expect-error` suppresses the errors on **one** line, and an inline `EvidenceRef` literal with
 * the wrong `kind` reports on its `ref` property rather than on its `kind`, so the directive would
 * sit above the wrong line and silently pass. Naming the value first puts the one error on the one
 * line the directive covers.
 *
 * `EvidenceRef` is published in both emitted schemas with `additionalProperties: false` on each
 * branch, so widening it is a change every consumer must re-validate against — and [SD §4.6.2]'s
 * E-CANON-STRICT is why it must not be widened: an unadmitted message "acquires no `eventId`, is
 * filed under no fact key, and enters no contest". `src:nmfta-ebol`, the one publisher that models
 * both lodging a bill of lading and the bill of lading, returns an **acceptance identifier distinct
 * from the document identifier**.
 */
const theMessageAsIngestSpellsIt = {
  kind: 'inboundMessage',
  ref: inboundMessageRef('inbound'),
} as const

// @ts-expect-error [A6 §3.5(c)] — `inboundMessage` is NOT a branch of the published `EvidenceRef`.
// If this directive ever goes unused, someone widened the union: read [A6 §3.5(c)] first, then
// classify the change under [catalog §2.3] and bump `CATALOG_VERSION`.
const refusedOnTheWire: EvidenceRef = theMessageAsIngestSpellsIt
void refusedOnTheWire

/**
 * And the ingest-side widening A6 **ratified** is legal, which is the other half of the same
 * decision: the link survives on the boundary side, where E-CANON-OBLIGATION already requires the
 * message to be retained verbatim. If this line ever stops compiling, the ratification has been
 * undone and [SD §4.6.2]'s sentence has nowhere left to be true.
 */
const acceptedAtTheBoundary: BoundaryEvidenceRef = theMessageAsIngestSpellsIt
void acceptedAtTheBoundary

/** A `BoundaryEvidenceRef` is a superset, so both published branches must still fit it. */
const bothPublishedBranchesStillFit: readonly BoundaryEvidenceRef[] = [aDocument, anAssertion]
void bothPublishedBranchesStillFit

/**
 * The asymmetry, held in the types: every `EvidenceRef` is a `BoundaryEvidenceRef`, and not every
 * `BoundaryEvidenceRef` is an `EvidenceRef`. That is the whole shape of [A6 §3.5(c)] — the boundary
 * may carry more than the wire does — and it is stated here rather than in a comment so that fusing
 * the two types stops compiling.
 */
const everyWireRefIsABoundaryRef: BoundaryEvidenceRef = aDocument
void everyWireRefIsABoundaryRef

const anyBoundaryRef: BoundaryEvidenceRef = theMessageAsIngestSpellsIt
// @ts-expect-error [A6 §3.5(c)] — the ingest-local type must NOT be assignable to the published
// union. If it becomes assignable the two have been fused, and the wire has silently gained a branch.
const notTheOtherWay: EvidenceRef = anyBoundaryRef
void notTheOtherWay
