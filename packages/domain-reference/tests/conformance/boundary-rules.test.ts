/**
 * Conformance — the boundary rules, behaviourally.
 *
 * The type-level half is `boundary-rules-refuses.ts`. This half runs the verdicts, because
 * [SD §4.6.2] titles itself "The three parts, **stated so they are testable**" and [SD §4.6.3] is
 * the case the blocker required. A worked example nobody executes is prose again.
 */
import { describe, expect, it } from 'vitest'

import {
  CANONICAL_SUBJECT_FAMILY,
  M3_SHIPPEO_GEOFENCE_COLUMN,
  M7_ELIGIBILITY,
  RECORD_TYPES,
  HARD_CASE_SHIPMENT_PHRASED_ARRIVAL,
  checkCapture,
  hardCaseAttempt,
  hardCaseSubmission,
  ingest,
  isGeofenceEligible,
  symmetricCaseSubmission,
  workHardCase,
  eventId,
  instant,
  partyId,
  ruleRef,
  specVersion,
  stopId,
  subjectRef,
  type CaptureFacts,
} from '../../src/index'

const spec = specVersion('1')
const R = ruleRef('R-SUBJECT-ARRIVAL-FROM-DESTINATION-AGENT', '1.0.0')
const { shipment, stop4, stop9, destinationAgent, saidAt } = HARD_CASE_SHIPMENT_PHRASED_ARRIVAL

describe('[SD §4.6] E-CANON — reject, never re-key', () => {
  it('E-CANON-STRICT refuses a shipment-phrased arrival, and the refusal keeps no key', () => {
    const verdict = ingest(hardCaseSubmission(spec))
    expect(verdict.outcome).toBe('RETAINED')
    if (verdict.outcome !== 'RETAINED') return
    // "It acquires no eventId, is filed under no fact key, and enters no contest."
    expect(verdict.retained.eventId).toBeUndefined()
    expect(verdict.retained.factKey).toBeUndefined()
    expect(verdict.retained.considered).toBeUndefined()
    expect(verdict.retained.refusal.code).toBe('SUBJECT_OUTSIDE_DECLARED_FAMILY')
    expect(verdict.retained.refusal.named).toBe('shipment')
    expect(verdict.retained.refusal.declaredFamily).toBe('stop')
    // "the inbound message verbatim, the type and subject it named… are retained"
    expect(verdict.retained.claimed.subject).toEqual(shipment)
    // "…and emits a notification obligation to the asserting party naming what it must supply."
    expect(verdict.retained.obligation.owedTo).toEqual(destinationAgent)
    expect(verdict.retained.obligation.members).toEqual(['stop', 'externallyPerformedLeg'])
    // [SD §4.7.3] the recipient has no field; it is owed, not defaulted.
    expect(verdict.retained.obligation.target.owed).toBe('notificationTarget')
  })

  it('[SD §4.6.3] steps 1-3: two candidate stops fail at cardinality, with no tie-break', () => {
    const { twoCandidates } = workHardCase(spec, R)
    expect(twoCandidates.outcome).toBe('RETAINED')
    if (twoCandidates.outcome !== 'RETAINED') return
    const attempted = twoCandidates.retained.attempted
    expect(attempted?.candidates).toEqual([stop4, stop9])
    // Neither candidate was chosen: "there is no implicit nearest-subject-wins either."
    expect(twoCandidates.retained.claimed.subject).toEqual(shipment)
  })

  it('[SD §4.6.3] step 5: the claim is theirs, the resolution is ours, both are on the record', () => {
    const { stopSupplied } = workHardCase(spec, R)
    expect(stopSupplied.outcome).toBe('ADMITTED_AFTER_RESOLUTION')
    if (stopSupplied.outcome !== 'ADMITTED_AFTER_RESOLUTION') return
    const record = stopSupplied.submission
    expect(record.subject).toEqual(stop9)
    expect(record.context).toEqual([shipment])
    expect(record.evidence).toHaveLength(1)
    expect(record.assertedBy).toEqual(destinationAgent)
    // "assertedAt = when THEY said it (not when we resolved it)."
    expect(record.assertedAt).toBe(saidAt)
    expect(record.resolvedBy).toEqual(R)
    expect(record.eventId).toBeUndefined()
  })

  it('[SD §4.6.3] the one-candidate record is identical in SHAPE to step 5’s', () => {
    const { stopSupplied, oneCandidate } = workHardCase(spec, R)
    expect(oneCandidate.outcome).toBe('ADMITTED_AFTER_RESOLUTION')
    if (
      oneCandidate.outcome !== 'ADMITTED_AFTER_RESOLUTION' ||
      stopSupplied.outcome !== 'ADMITTED_AFTER_RESOLUTION'
    ) {
      return
    }
    // "the successful and the unsuccessful path produce the same KIND of record, so the model has
    // one behaviour with a cardinality gate, not two behaviours" — same fields, different stop.
    expect(Object.keys(oneCandidate.submission).sort()).toEqual(
      Object.keys(stopSupplied.submission).sort(),
    )
    expect(oneCandidate.submission.subject).toEqual(stop4)
    expect(stopSupplied.submission.subject).toEqual(stop9)
    expect(oneCandidate.submission.context).toEqual(stopSupplied.submission.context)
    expect(oneCandidate.submission.evidence).toEqual(stopSupplied.submission.evidence)
    expect(oneCandidate.submission.capturedBy).toBe(stopSupplied.submission.capturedBy)
  })

  it('zero candidates fails too, and fails differently from ambiguity', () => {
    const verdict = ingest(hardCaseSubmission(spec), hardCaseAttempt([], R))
    expect(verdict.outcome).toBe('RETAINED')
    if (verdict.outcome !== 'RETAINED') return
    expect(verdict.retained.attempted?.candidates).toEqual([])
  })

  it('a canonically-phrased arrival is admitted as named, and is never re-phrased', () => {
    const canonical = { ...hardCaseSubmission(spec), namedSubject: stop9 }
    const verdict = ingest(canonical, hardCaseAttempt([stop4, stop9], R))
    expect(verdict.outcome).toBe('ADMITTED_AS_NAMED')
    if (verdict.outcome !== 'ADMITTED_AS_NAMED') return
    expect(verdict.subject).toEqual(stop9)
  })

  it('[SD §4.6.3] the symmetric case: our own driver app hits E-CANON in the other direction', () => {
    const driver = { party: partyId('driver'), role: 'driver' } as const
    const submission = symmetricCaseSubmission(
      spec,
      subjectRef('stop', stopId('T')),
      driver,
      instant('2026-03-04T16:00:00Z'),
    )
    const verdict = ingest(submission)
    expect(verdict.outcome).toBe('RETAINED')
    if (verdict.outcome !== 'RETAINED') return
    // delivery's family is goods = {shipment, portion}; `stop` is not a member.
    expect(verdict.retained.refusal.declaredFamily).toBe('goods')
    expect(verdict.retained.refusal.named).toBe('stop')
  })
})

const facts = (over: Partial<CaptureFacts> & Pick<CaptureFacts, 'type'>): CaptureFacts => ({
  basis: 'ACTUAL',
  capturedBy: 'KEYED_BY_PERSON',
  reasonCount: 0,
  ...over,
})

describe('[SD §5.2] M1-M7 — the machine-assertion rule, cut by capture method', () => {
  it('M1 [ORIGINAL]: ASSUMED_FROM_PLAN may never carry basis = ACTUAL', () => {
    const verdict = checkCapture(facts({ type: 'arrival', capturedBy: 'ASSUMED_FROM_PLAN' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection.rule).toBe('M1')
  })

  it('M1 forbids the basis, not the method: the same assertion at PLANNED is not an M1 defect', () => {
    const verdict = checkCapture(
      facts({ type: 'arrival', basis: 'PLANNED', capturedBy: 'ASSUMED_FROM_PLAN' }),
    )
    expect(verdict.verdict).not.toBe('REJECTED')
  })

  it('M2: a possession-changing act at ACTUAL needs a human or a partner', () => {
    const verdict = checkCapture(facts({ type: 'delivery', capturedBy: 'DEVICE_GEOFENCE' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({
      rule: 'M2',
      code: 'POSSESSION_CHANGING_NEEDS_HUMAN_OR_PARTNER',
    })
  })

  it('M2/M4: M4 does not reach into M2’s list — no derived substitute for a witnessed act', () => {
    const verdict = checkCapture(facts({ type: 'storeIn', capturedBy: 'DERIVED_BY_RULE' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({
      rule: 'M2',
      code: 'DERIVED_SUBSTITUTE_FOR_A_WITNESSED_ACT',
      theDifferentFactClass: 'sitEntryDate',
    })
  })

  it('M2 admits the three asserters it names', () => {
    for (const capturedBy of [
      'OBSERVED_BY_PERSON',
      'KEYED_BY_PERSON',
      'PARTNER_ASSERTED',
    ] as const) {
      expect(checkCapture(facts({ type: 'storeIn', capturedBy })).verdict).toBe('ADMITTED')
    }
  })

  it('M3: a non-COMPLETED outcome requires a human or partner asserter', () => {
    const verdict = checkCapture(
      facts({
        type: 'tripDelay',
        capturedBy: 'DEVICE_TELEMETRY',
        outcome: 'NOT_COMPLETED',
        reasonCount: 1,
      }),
    )
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({
      rule: 'M3',
      code: 'EXCEPTION_NEEDS_HUMAN_OR_PARTNER',
    })
  })

  it('M3 [ORIGINAL, stricter than the source]: a machine may not assert WHY something is late', () => {
    // `CALCULATED_DELAY_DRIVING_TOWARD_SITE_*` is exactly this shape, and Shippeo permits it.
    const verdict = checkCapture(
      facts({
        type: 'tripDelay',
        capturedBy: 'DERIVED_BY_RULE',
        outcome: 'NOT_COMPLETED',
        reasonCount: 1,
      }),
    )
    expect(verdict.verdict).toBe('REJECTED')
  })

  it('M3’s sourced count is the corrected one: 38 rows, 7 geofence-marked, none an exception', () => {
    expect(M3_SHIPPEO_GEOFENCE_COLUMN.dataRows).toBe(38)
    expect(M3_SHIPPEO_GEOFENCE_COLUMN.geofenceMarked).toHaveLength(
      M3_SHIPPEO_GEOFENCE_COLUMN.geofenceMarkedRows,
    )
    expect(M3_SHIPPEO_GEOFENCE_COLUMN.geofenceMarkedExceptionRows).toBe(0)
  })

  it('M4: the SIT entry date is mandatorily derived — a keyed one is a detectable defect', () => {
    const verdict = checkCapture(facts({ type: 'sitEntryDate', capturedBy: 'KEYED_BY_PERSON' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({
      rule: 'M4',
      code: 'DECLARED_DERIVED_MUST_BE_DERIVED',
    })
  })

  it('M4: a derivation must carry its rule AND the eventIds of its inputs', () => {
    const missing = checkCapture(facts({ type: 'sitEntryDate', capturedBy: 'DERIVED_BY_RULE' }))
    expect(missing.verdict).toBe('REJECTED')
    if (missing.verdict !== 'REJECTED') return
    expect(missing.rejection).toMatchObject({
      rule: 'M4',
      code: 'DERIVATION_MISSING_RULE_OR_INPUTS',
    })

    const complete = checkCapture(
      facts({
        type: 'sitEntryDate',
        capturedBy: 'DERIVED_BY_RULE',
        derivation: {
          rule: ruleRef('R-SIT-ENTRY-DATE', '1.0.0'),
          inputs: [eventId('first-available-delivery-date')],
        },
      }),
    )
    expect(complete.verdict).toBe('ADMITTED')
  })

  it('M4: DERIVED_BY_RULE on a class the catalog has not declared derived is refused', () => {
    const verdict = checkCapture(facts({ type: 'weight.net', capturedBy: 'DERIVED_BY_RULE' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({ rule: 'M4', code: 'DERIVATION_NOT_DECLARED' })
  })

  it('M5: a geofence may assert arrival and departure at ACTUAL', () => {
    for (const type of ['arrival', 'departure'] as const) {
      expect(checkCapture(facts({ type, capturedBy: 'DEVICE_GEOFENCE' })).verdict).toBe('ADMITTED')
    }
  })

  it('M5: and nothing else', () => {
    const verdict = checkCapture(facts({ type: 'pieceCount', capturedBy: 'DEVICE_GEOFENCE' }))
    expect(verdict.verdict).toBe('REJECTED')
    if (verdict.verdict !== 'REJECTED') return
    expect(verdict.rejection).toMatchObject({ rule: 'M5', code: 'GEOFENCE_MAY_NOT_ASSERT_THIS' })
  })

  it('M6(a): geofence-derived conformity is inexpressible — CON_LOAD/CON_UNLOAD have nowhere to go', () => {
    // There is no conformity type ([SD §4.1] puts it at `condition`/`item` grain), and the acts a
    // conformity claim would ride on refuse a geofence under M2.
    expect(isGeofenceEligible('loading')).toBe(false)
    expect(isGeofenceEligible('delivery')).toBe(false)
    expect(checkCapture(facts({ type: 'loading', capturedBy: 'DEVICE_GEOFENCE' })).verdict).toBe(
      'REJECTED',
    )
    expect((RECORD_TYPES as readonly string[]).includes('conformity')).toBe(false)
  })

  it('M7: eligibility is declared per record type, for every record type', () => {
    for (const type of RECORD_TYPES) {
      expect(M7_ELIGIBILITY[type]).toBeDefined()
    }
  })

  it('M7: where no document declares a set, the verdict says so rather than admitting', () => {
    const verdict = checkCapture(facts({ type: 'weight.net' }))
    expect(verdict.verdict).toBe('UNDECLARED')
    if (verdict.verdict !== 'UNDECLARED') return
    expect(verdict.owed.owed).toBe('captureEligibility')
  })
})

describe('[SD §5.3] the store-in act and the SIT entry date are two fact classes', () => {
  it('same subject family, opposite capture rules — which is what makes M2 and M4 consistent', () => {
    expect(CANONICAL_SUBJECT_FAMILY.storeIn).toBe('stay')
    expect(CANONICAL_SUBJECT_FAMILY.sitEntryDate).toBe('stay')

    const keyed = 'KEYED_BY_PERSON' as const
    const derived = {
      rule: ruleRef('R-SIT-ENTRY-DATE', '1.0.0'),
      inputs: [eventId('fadd')],
    } as const

    // The act: a human keys it, and a rule may not derive it.
    expect(checkCapture(facts({ type: 'storeIn', capturedBy: keyed })).verdict).toBe('ADMITTED')
    expect(
      checkCapture(facts({ type: 'storeIn', capturedBy: 'DERIVED_BY_RULE', derivation: derived }))
        .verdict,
    ).toBe('REJECTED')

    // The date: a rule derives it, and a human may not key it. Exactly inverted.
    expect(checkCapture(facts({ type: 'sitEntryDate', capturedBy: keyed })).verdict).toBe(
      'REJECTED',
    )
    expect(
      checkCapture(
        facts({ type: 'sitEntryDate', capturedBy: 'DERIVED_BY_RULE', derivation: derived }),
      ).verdict,
    ).toBe('ADMITTED')
  })
})
