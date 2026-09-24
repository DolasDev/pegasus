/**
 * **Scenario 7 — the same arrival asserted by the driver's app and by the destination agent.**
 *
 * The critique called this "the scenario the document names in its own opening and cannot express",
 * and it failed twice over. Once because `basis` was "never ACTUAL", so the second party's actual
 * "must be published as a **second `OccurrenceEvent`** — two arrivals for one arriving". And once
 * because the two claims were on different subjects: "the driver's app asserts arrival at a
 * **stop**; the destination agent asserts arrival of a **shipment**… A selection rule keyed on
 * (subject, milestone) therefore never sees the two claims as competitors at all."
 *
 * Both halves are answered, and by different decisions. [SD §4.5] puts the second party's ACTUAL in
 * an ordinary Assertion. [SD §4.6] makes the agent's shipment-phrased claim a **boundary refusal**
 * rather than a silent re-key — and then E-CANON-RESOLVE, at cardinality exactly one, admits a
 * record that pairs with the driver's on the derived fact key ([SD §1.3]). They compete; a named,
 * versioned rule resolves; the loser stays in `considered[]` ([SD §4.3], [A8 §7.4]).
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITATIVE_ROLE_AT_INSTANT,
  AUTHORITY_TABLE,
  admitAtBoundary,
  authoritativeHolderAt,
  custodyAt,
  eventId,
  factRefOf,
  factResolvedSubjectMatches,
  inboundMessageRef,
  ingest,
  instant,
  instantTheFactIsAbout,
  listedStandingOf,
  partyId,
  recencyIsPublishedFor,
  ruleRef,
  sameFactKey,
  selectionIsAmongConsidered,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type AttemptedResolution,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type FactResolved,
  type Submission,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S-2204'))
const destinationStop = subjectRef('stop', stopId('ST-19'))
const otherStop = subjectRef('stop', stopId('ST-24'))
const trip = subjectRef('trip', tripId('T-7781'))

const driver = { party: partyId('P-DRIVER-MAE'), role: 'driver' } as const
const destinationAgent = { party: partyId('P-DEST-CO'), role: 'destinationAgent' } as const
const platform = partyId('P-PLATFORM')

/** The two claims differ, which is the whole point: 13:58 by geofence, 14:20 by the agent. */
const geofencedAt = instant('2026-09-02T13:58:00Z')
const agentSaysAt = instant('2026-09-02T14:20:00Z')

/**
 * The driver's app. [SD §5.2] M5 permits a geofence to carry `basis = ACTUAL` for arrival at a stop
 * — "five of Shippeo's seven geofence-eligible rows are exactly these" — and it is phrased on the
 * canonical subject already, so the boundary admits it as named.
 */
const driverApp: CapturedAssertion<'arrival'> = {
  eventId: eventId('A-DRIVER'),
  type: 'arrival',
  specVersion: spec,
  subject: destinationStop,
  assertedBy: driver,
  assertedAt: instant('2026-09-02T13:58:04Z'),
  capturedBy: 'DEVICE_GEOFENCE',
  context: [trip, shipment],
  basis: 'ACTUAL',
  value: { at: geofencedAt },
}

/** The agent keys "shipment S arrived" — [SD §4.6.3]'s worked claim, in its own words. */
const agentClaim: Submission<'arrival'> = {
  type: 'arrival',
  namedSubject: shipment,
  assertedBy: destinationAgent,
  assertedAt: instant('2026-09-02T14:31:00Z'),
  specVersion: spec,
  inboundMessage: inboundMessageRef('agent keyed: "shipment S-2204 arrived 14:20"'),
  capturedBy: 'KEYED_BY_PERSON',
}

const subjectResolutionRule = ruleRef('R-ARRIVAL-SUBJECT-FROM-SHIPMENT', '1.0.0')

function attempt(candidates: readonly (typeof destinationStop)[]): AttemptedResolution<'arrival'> {
  return { rule: subjectResolutionRule, candidates, capturedBy: 'KEYED_BY_PERSON' }
}

describe("[SD §4.6] the agent's claim is refused before it can be re-keyed", () => {
  it("E-CANON-STRICT: `shipment` is not in `arrival`'s declared family", () => {
    const refusal = admitAtBoundary(agentClaim)
    expect(refusal.admitted).toBe(false)
    if (refusal.admitted) return
    expect(refusal.code).toBe('SUBJECT_OUTSIDE_DECLARED_FAMILY')
    expect(refusal.declaredFamily).toBe('stop')
    // "The boundary performs no substitution, no nearest-match and no best-guess."
    expect(refusal.named).toBe('shipment')
  })

  it('E-CANON-OBLIGATION: retained outside the catalog, with an obligation, and NO eventId', () => {
    const verdict = ingest(agentClaim)
    expect(verdict.outcome).toBe('RETAINED')
    if (verdict.outcome !== 'RETAINED') return
    expect(verdict.retained.retainedOutsideTheCatalog).toBe(true)
    expect(verdict.retained.inboundMessage).toBe(agentClaim.inboundMessage)
    expect(verdict.retained.obligation.owedTo).toEqual(destinationAgent)
    expect(verdict.retained.obligation.mustSupply).toBe('A_SUBJECT_IN_THE_DECLARED_FAMILY')
    // [SD §4.6.3] step 4: it is NOT in `considered[]`, "because `considered[]` names every assertion
    // in the contest and this one never entered it." Held structurally — it has no eventId to name.
    expect(verdict.retained.eventId).toBeUndefined()
  })

  it('and at two candidate stops it stays refused — there is no nearest-subject-wins', () => {
    // [SD §4.6.3] step 2, on a split-delivered van: "it returns **two** candidates… Resolution
    // fails at cardinality." A8-NAMED's prohibition has a subject-side twin.
    const ambiguous = ingest(agentClaim, attempt([destinationStop, otherStop]))
    expect(ambiguous.outcome).toBe('RETAINED')
    if (ambiguous.outcome !== 'RETAINED') return
    expect(ambiguous.retained.attempted?.candidates).toHaveLength(2)
    const resolution = ingest(agentClaim, attempt([]))
    expect(resolution.outcome).toBe('RETAINED')
  })
})

describe('[SD §4.6.2] E-CANON-RESOLVE at cardinality one — and then they compete', () => {
  const resolved = ingest(agentClaim, attempt([destinationStop]))

  it('keeps the claim theirs and the resolution ours, both on the record', () => {
    expect(resolved.outcome).toBe('ADMITTED_AFTER_RESOLUTION')
    if (resolved.outcome !== 'ADMITTED_AFTER_RESOLUTION') return
    const rephrased = resolved.submission
    expect(rephrased.subject).toEqual(destinationStop)
    // Theirs: the subject they actually named goes in `context[]`, non-authoritatively, "which is
    // what makes the re-phrasing disputable instead of invisible".
    expect(rephrased.context).toEqual([shipment])
    expect(rephrased.assertedBy).toEqual(destinationAgent)
    // [SD §4.6.3] step 5: "`assertedAt` = when _they_ said it (not when we resolved it)."
    expect(rephrased.assertedAt).toBe(agentClaim.assertedAt)
    // Ours: the rule, named and versioned, the same shape as `FactResolved.rule`.
    expect(rephrased.resolvedBy).toEqual(subjectResolutionRule)
  })

  it('[A6 §3.5(c)] the inbound message rides on the boundary side, and that is the decision', () => {
    // This test used to be the finding: [SD §4.6.2] says "the inbound message goes in `evidence[]`",
    // `EvidenceRef` is a `document` aggregate or an assertion `eventId`, and an unadmitted message is
    // demonstrably neither — E-CANON-STRICT gives it no `eventId`, and no source makes a transmission
    // an instrument.
    //
    // [A6 §3.5(c)] RATIFIED the ingest-local widening rather than promoting it. Two grounds.
    // `src:nmfta-ebol` is the one publisher that models both lodging a bill of lading and the bill of
    // lading, and it returns an **acceptance identifier distinct from the document identifier** — so
    // a submission and an instrument are different facts wherever anyone has modelled both. And the
    // cost is asymmetric: `EvidenceRef` is published with `additionalProperties: false` on both
    // branches, so widening it bills every consumer for a re-validation, while ratifying costs no
    // published byte. [SD §4.6.2]'s sentence is therefore true HERE, on the boundary side.
    if (resolved.outcome !== 'ADMITTED_AFTER_RESOLUTION') return
    expect(resolved.submission.evidence[0]).toMatchObject({ kind: 'inboundMessage' })
  })

  it('[A6 §3.5(c)] and the boundary-side ref is not assignable to a published `evidence[]`', () => {
    // The consequence A6 states rather than implies: E-CANON-OBLIGATION retains the message verbatim
    // on the boundary side, so nothing is lost — but a consumer reading a published Assertion's
    // `evidence[]` will not find it there.
    //
    // A first draft asserted `expect(agentArrival.evidence).toBeUndefined()`, which reads a fixture
    // this file wrote and can never fail. The real gate is a type gate, because the claim is that one
    // type is NOT assignable to another: `tests/conformance/document-evidence-refuses.ts`, tampered by
    // widening `EvidenceRef` and watched to report both `@ts-expect-error` directives unused. What
    // this test can honestly check is that the boundary ref really is the widened kind and therefore
    // really is the value the type gate refuses.
    if (resolved.outcome !== 'ADMITTED_AFTER_RESOLUTION') return
    const carried = resolved.submission.evidence[0]
    expect(carried?.kind).toBe('inboundMessage')
    expect(['document', 'assertion']).not.toContain(carried?.kind)
  })

  /**
   * The Assertion minted from the re-phrased submission — identical in shape to a claim that had
   * been phrased canonically in the first place ([SD §4.6.3]: "the record admitted is _identical in
   * shape_ to step 5's"), plus the `eventId` the catalog assigns on admission.
   */
  const agentArrival: CapturedAssertion<'arrival'> = {
    eventId: eventId('A-AGENT'),
    type: 'arrival',
    specVersion: spec,
    subject: destinationStop,
    assertedBy: destinationAgent,
    assertedAt: agentClaim.assertedAt,
    capturedBy: 'KEYED_BY_PERSON',
    context: [shipment],
    basis: 'ACTUAL',
    value: { at: agentSaysAt },
  }

  it("[SD §1.3] pairs the two claims on the DERIVED fact key — the critique's second half", () => {
    // Two parties, two capture methods, two different times, one key. Note what the key does not
    // read: `context[]`, `assertedBy`, `basis` — so the shipment riding in the agent's context does
    // not split the contest, and the driver's geofence does not sit in a class of its own.
    expect(sameFactKey(factRefOf(driverApp), factRefOf(agentArrival))).toBe(true)
    expect(factRefOf(agentArrival)).toEqual({ subject: destinationStop, type: 'arrival' })
    expect(driverApp.value.at).not.toBe(agentArrival.value.at)
  })

  it('[SD §4.5] and both are ACTUAL — `OccurrenceEvent` is abolished, not worked around', () => {
    expect(driverApp.basis).toBe('ACTUAL')
    expect(agentArrival.basis).toBe('ACTUAL')
    // There is no second record class for "what happened": the catalog's view is the selected
    // projection over ACTUAL assertions, published by `FactResolved`.
  })

  describe('[SD §4.3] the contest, resolved', () => {
    const resolution: FactResolved<'arrival'> = {
      eventId: eventId('FR-A-ST19'),
      type: 'FactResolved',
      specVersion: spec,
      subject: destinationStop,
      assertedBy: { party: platform, role: 'platform' },
      assertedAt: instant('2026-09-02T14:45:00Z'),
      capturedBy: 'DERIVED_BY_RULE',
      factRef: { subject: destinationStop, type: 'arrival' },
      selected: driverApp.eventId,
      considered: [driverApp.eventId, agentArrival.eventId],
      rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    }

    it('names a rule AND a version, and keeps the loser in considered[]', () => {
      expect(resolution.rule).toEqual(ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'))
      expect(resolution.considered).toContain(agentArrival.eventId)
      expect(selectionIsAmongConsidered(resolution)).toBe(true)
      expect(factResolvedSubjectMatches(resolution)).toBe(true)
      // Append-only: the losing assertion "does not become false, is never retracted, and is never
      // deleted" ([A8 §7.4] (a)). It is still a record, with its own time, in the catalog.
      expect(agentArrival.value.at).toBe(agentSaysAt)
    })

    it('[A8 §5 r1] the winner is the role holding custody, and the agent COMPETES', () => {
      // The agent is not advisory here: [round-2-critique]'s own example is the destination agent's
      // claim against the driver's, and row 1 lists `destinationAgent` as competing at destination —
      // "both are real and E-CANON is what makes them pair."
      expect(listedStandingOf('arrival', 'destinationAgent')).toBe('competing')
      expect(AUTHORITY_TABLE.arrival.authoritative).toMatchObject({
        kind: 'held',
        primary: { kind: 'custodyHolder' },
      })
    })

    it('[A8 §4.4] A8-NAMED — and the resolution may never fall back to latest-wins', () => {
      // The agent spoke last (14:31 against 13:58:04) and lost. Recency is a legal `ruleId` only
      // where the catalog has published it for that fact class, and the registry is empty.
      expect(Date.parse(agentArrival.assertedAt)).toBeGreaterThan(Date.parse(driverApp.assertedAt))
      expect(recencyIsPublishedFor('arrival')).toBe(false)
    })

    it('a CUSTODY-bound row has no answer while the fold has none — it does not guess', () => {
      const evidence: CustodyEvidence = {
        handovers: [],
        resolutions: [],
        legs: [],
      }
      const at = instantTheFactIsAbout(driverApp)
      expect(at.resolved).toBe(true)
      if (!at.resolved) return
      const context: AuthorityContext = {
        at: at.at,
        custody: custodyAt(shipment, geofencedAt, evidence),
      }
      // [SD §4.8.3] rule 3 propagating: no published handover means no known holder, and inventing
      // one here "would be the last-writer-wins fall-through the fold refused two modules down".
      expect(authoritativeHolderAt('arrival', context).kind).toBe('custodyUnknown')
    })
  })
})
