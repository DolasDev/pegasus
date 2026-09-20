/**
 * Conformance — the invariants, as properties rather than as examples.
 *
 * The other conformance files check the cases the documents work through. This one checks the
 * rules **over the whole space they quantify over**, because each of the five below is stated by
 * its document as a universal ("every", "never", "MUST NOT") and a universal tested on two examples
 * is an example.
 *
 * | Invariant                                                     | Stated at                  |
 * | ------------------------------------------------------------- | -------------------------- |
 * | an act record never carries a tense on the envelope            | [SD §1.1], [SD §4.2]       |
 * | `outcome` cannot appear with `basis ≠ ACTUAL`                  | [SD §2.3] invariant 1      |
 * | `COMPLETED` forbids reasons; every other outcome requires one  | [SD §2.3] invariant 2      |
 * | `ASSUMED_FROM_PLAN` can never produce an `ACTUAL`              | [SD §5.2] **M1**           |
 * | `custodyAt` never returns two holders and never invents one    | [SD §4.8.3] rules 1 and 3  |
 *
 * Where the invariant is expressible in the types, it is tested twice: once with a
 * `@ts-expect-error` that must fire (the illegal state fails to compile — the package's actual
 * claim) and once over constructed records (the predicate a consumer holding a runtime value is
 * measured against). The two are not redundant. The type-level half is the one that prevents the
 * defect; the runtime half is the one that survives a cast.
 */
import { describe, expect, it } from 'vitest'

import {
  ACT_TYPES,
  ASSERTION_TYPES,
  BASES,
  CANONICAL_SUBJECT_FAMILY,
  CAPTURE_METHODS,
  CUSTODY_AT_RULE,
  CUSTODY_UNKNOWN_REASONS,
  HANDED_OVER,
  HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY,
  OUTCOMES,
  SUBJECT_FAMILIES,
  aggregateId,
  checkCapture,
  checkCaptureOf,
  custodyAt,
  eventId,
  externallyPerformedLegId,
  factRefOf,
  instant,
  isWellFormedActOutcome,
  partyId,
  partyRoleId,
  reasonCode,
  reasonsAreRequired,
  roleClass,
  ruleRef,
  sameFactKey,
  selectedHandovers,
  shipmentId,
  specVersion,
  subjectRef,
  type ActType,
  type AggregateKind,
  type AssertionType,
  type Basis,
  type CaptureFacts,
  type CapturedAssertion,
  type CustodyEvidence,
  type CustodyHolder,
  type ExternallyPerformedLeg,
  type FactResolved,
  type HandoverSide,
  type Outcome,
  type Reason,
  type SubjectRef,
} from '../../src/index'

const spec = specVersion('1')
const asserter = { party: partyId('p1'), role: 'destinationAgent' } as const
const saidAt = instant('2026-03-01T10:00:00Z')
const occurredAt = instant('2026-03-01T09:00:00Z')

const A_REASON: Reason = {
  code: reasonCode('SHORT'),
  scope: 'GOODS',
  attribution: { roleClass: roleClass('unknown') },
}

/** The first member of the family a type declares — an act's subject, chosen mechanically. */
function subjectFor(type: AssertionType): SubjectRef {
  const members: readonly AggregateKind[] = SUBJECT_FAMILIES[CANONICAL_SUBJECT_FAMILY[type]]
  const kind = members[0]
  if (kind === undefined) throw new Error(`${type}'s family is empty`)
  return subjectRef(kind, aggregateId(kind, 's'))
}

/**
 * One act record, at any basis, with or without an outcome.
 *
 * The single cast is the same one `factRefOf` and `captureFactsOf` take in `src/`, and for the same
 * reason ([SD §1.3]): `CapturedAssertion<T>` is a distributive union over nineteen act types and
 * five bases, and a sweep constructs its members generically. Casting **into** the union is exactly
 * what makes the runtime half of these tests worth running — it is how a real consumer's record
 * arrives, off a wire, having satisfied no compiler.
 */
function actRecord(
  type: ActType,
  basis: Basis,
  outcome?: Outcome,
  reasons: readonly Reason[] = [],
): CapturedAssertion<ActType> {
  const value = {
    occurredAt,
    ...(type === 'handover' ? { custodyBasis: HANDED_OVER } : {}),
    ...(outcome === undefined ? {} : { outcome }),
    ...(reasons.length === 0 ? {} : { reasons }),
  }
  return {
    eventId: eventId(`${type}-${basis}`),
    type,
    specVersion: spec,
    subject: subjectFor(type),
    assertedBy: asserter,
    assertedAt: saidAt,
    capturedBy: 'KEYED_BY_PERSON',
    basis,
    value,
  } as unknown as CapturedAssertion<ActType>
}

/** The whole space the outcome invariants quantify over: every act, every basis, every outcome. */
function everyActRecord(): { type: ActType; basis: Basis; record: CapturedAssertion<ActType> }[] {
  const corpus: { type: ActType; basis: Basis; record: CapturedAssertion<ActType> }[] = []
  for (const type of ACT_TYPES) {
    for (const basis of BASES) {
      if (basis === 'ACTUAL') {
        corpus.push({ type, basis, record: actRecord(type, basis, 'COMPLETED') })
        for (const outcome of OUTCOMES) {
          if (outcome === 'COMPLETED') continue
          corpus.push({ type, basis, record: actRecord(type, basis, outcome, [A_REASON]) })
        }
      } else {
        corpus.push({ type, basis, record: actRecord(type, basis) })
      }
    }
  }
  return corpus
}

const CORPUS = everyActRecord()

describe('[SD §1.1] an act record never carries a tense on the envelope', () => {
  it('carries none of the permanently-prohibited envelope fields, at any basis', () => {
    // [SD §1.1]: "A tense qualifier. Tense lives on the time _value_ as `basis`" — which is why
    // the corpus above varies `basis` and every record still has to be tense-free. The other five
    // are the rest of §1.1's prohibition list, checked in the same sweep because they are the same
    // defect wearing different names (DCSA's `eventClassifierCode` IS a tense qualifier).
    const forbidden = [
      'tense',
      'eventClassifierCode',
      'factClass',
      'status',
      'currentState',
      'subjects',
      'secondSubject',
      'subjectPath',
      'correlation',
      'causedBy',
    ] as const
    expect(CORPUS.length).toBe(ACT_TYPES.length * (BASES.length - 1 + OUTCOMES.length))
    for (const { type, basis, record } of CORPUS) {
      for (const field of forbidden) {
        expect(field in record, `${type} at ${basis} carries \`${field}\``).toBe(false)
      }
      // The tense that IS legal is on the value's own axis, and there is exactly one of it.
      expect(record.basis).toBe(basis)
    }
  })

  it('refuses a tense at compile time, which is the half that actually prevents it', () => {
    const head = {
      eventId: eventId('e'),
      specVersion: spec,
      subject: subjectRef('shipment', shipmentId('S1')),
      assertedBy: asserter,
      assertedAt: saidAt,
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
      value: { occurredAt, outcome: 'COMPLETED' },
    } as const

    // @ts-expect-error [SD §1.1] a tense qualifier on the envelope
    const withTense: CapturedAssertion<'delivery'> = { ...head, type: 'delivery', tense: 'ACTUAL' }
    void withTense

    // [SD §1.3] DCSA's spelling of the same thing — "we do not" carry two axes
    const withClassifier: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      // @ts-expect-error the property is the error: there is no second classification axis
      eventClassifierCode: 'ACT',
    }
    void withClassifier

    // [SD §1.1] "A second `subject`. One record, one subject"
    const withSecond: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      // @ts-expect-error the property is the error: one record, one subject
      secondSubject: subjectRef('shipment', shipmentId('S2')),
    }
    void withSecond

    // [SD §1.1] a subject path — "a path presumes a containment hierarchy"
    const withPath: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      // @ts-expect-error the property is the error: a subject is a ref, never a path
      subjectPath: 'shipment/S1/stop/T1',
    }
    void withPath

    // [SD §1.1] revision 3 defect C — the generic correlation bag is deleted
    const withCause: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      // @ts-expect-error the property is the error: the generic correlation bag is deleted
      causedBy: eventId('e0'),
    }
    void withCause

    // [SD §1.1] "A mutable current-state field… state is a projection"
    const withState: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      // @ts-expect-error the property is the error: state is a projection, never a stored field
      currentState: 'DELIVERED',
    }
    void withState
  })
})

describe('[SD §2.3] invariant 1 `outcome` cannot appear with basis ≠ ACTUAL', () => {
  it('holds over every act type at every basis', () => {
    // OTM's rule adopted verbatim: `result` only on `actual`/`realized`. A plan cannot carry an
    // outcome, so a planned act must not even be able to spell one.
    for (const { type, basis, record } of CORPUS) {
      const value = record.value as { outcome?: Outcome }
      const carries = value.outcome !== undefined
      expect(carries, `${type} at ${basis}`).toBe(basis === 'ACTUAL')
    }
  })

  it('refuses one at compile time, for a plan basis and for an estimate alike', () => {
    const head = {
      eventId: eventId('e'),
      specVersion: spec,
      subject: subjectRef('shipment', shipmentId('S1')),
      assertedBy: asserter,
      assertedAt: saidAt,
      capturedBy: 'KEYED_BY_PERSON',
    } as const

    // an outcome at basis = PLANNED
    const planned: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      basis: 'PLANNED',
      // @ts-expect-error the value is the error: a plan carries no outcome
      value: { occurredAt, outcome: 'COMPLETED' },
    }
    void planned

    // an outcome at basis = COMMITTED — the Agreed Delivery Period is not a result
    const committed: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      basis: 'COMMITTED',
      // @ts-expect-error the value is the error: a commitment carries no outcome
      value: { occurredAt, outcome: 'NOT_COMPLETED', reasons: [A_REASON] },
    }
    void committed

    // an outcome at basis = ESTIMATED, asOf supplied and still not licensed
    const estimated: CapturedAssertion<'delivery'> = {
      ...head,
      type: 'delivery',
      basis: 'ESTIMATED',
      asOf: saidAt,
      // @ts-expect-error the value is the error: an estimate carries no outcome
      value: { occurredAt, outcome: 'COMPLETED' },
    }
    void estimated
  })
})

describe('[SD §2.3] invariant 2 COMPLETED forbids reasons; everything else requires one', () => {
  it('agrees with `reasonsAreRequired` for all five outcomes, at every reason count', () => {
    for (const outcome of OUTCOMES) {
      const required = reasonsAreRequired(outcome)
      // Both halves are in the rule: `COMPLETED` cannot carry reasons, and nothing else can omit
      // them. Collapsing `CFM` into `COMPLETED` and forbidding a reason there is **[ORIGINAL]**.
      expect(required, `${outcome}`).toBe(outcome !== 'COMPLETED')
      for (const count of [0, 1, 2]) {
        const reasons = Array.from({ length: count }, () => A_REASON)
        const candidate = (
          outcome === 'COMPLETED'
            ? count === 0
              ? { outcome }
              : { outcome, reasons }
            : { outcome, reasons }
        ) as Parameters<typeof isWellFormedActOutcome>[0]
        expect(isWellFormedActOutcome(candidate), `${outcome} with ${count} reason(s)`).toBe(
          required ? count > 0 : count === 0,
        )
      }
    }
  })

  it('holds over every act record the corpus constructs', () => {
    for (const { type, basis, record } of CORPUS) {
      const value = record.value as { outcome?: Outcome; reasons?: readonly Reason[] }
      if (value.outcome === undefined) {
        expect(value.reasons, `${type} at ${basis} carries reasons with no outcome`).toBeUndefined()
        continue
      }
      const count = value.reasons?.length ?? 0
      expect(count > 0, `${type} ${value.outcome}`).toBe(reasonsAreRequired(value.outcome))
    }
  })

  it('refuses both halves at compile time', () => {
    const head = {
      eventId: eventId('e'),
      type: 'delivery',
      specVersion: spec,
      subject: subjectRef('shipment', shipmentId('S1')),
      assertedBy: asserter,
      assertedAt: saidAt,
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
    } as const

    // COMPLETED may not carry a reason
    const completed: CapturedAssertion<'delivery'> = {
      ...head,
      // @ts-expect-error the value is the error: COMPLETED forbids reasons
      value: { occurredAt, outcome: 'COMPLETED', reasons: [A_REASON] },
    }
    void completed

    // CANCELLED must carry one
    const cancelled: CapturedAssertion<'delivery'> = {
      ...head,
      // @ts-expect-error the value is the error: CANCELLED with no reasons at all
      value: { occurredAt, outcome: 'CANCELLED' },
    }
    void cancelled

    // an empty list is not "at least one" — `NonEmptyArray`, not `Reason[]`
    const empty: CapturedAssertion<'delivery'> = {
      ...head,
      // @ts-expect-error the value is the error: `reasons: []` is not a NonEmptyArray
      value: { occurredAt, outcome: 'PARTIALLY_COMPLETED', reasons: [] },
    }
    void empty
  })
})

describe('[SD §5.2] M1 ASSUMED_FROM_PLAN can never produce an ACTUAL', () => {
  it('rejects exactly the ASSUMED_FROM_PLAN × ACTUAL cell, for every record type', () => {
    // M1 runs first in `checkCapture`, "because M2 cites it as already having excluded
    // `ASSUMED_FROM_PLAN`" — so on this cell the verdict must be M1 and not some later rule that
    // would happen to refuse the same record for a different reason.
    let rejections = 0
    for (const type of ASSERTION_TYPES) {
      for (const basis of BASES) {
        for (const capturedBy of CAPTURE_METHODS) {
          const facts = { type, basis, capturedBy, reasonCount: 0 } satisfies CaptureFacts
          const verdict = checkCapture(facts)
          const isM1Cell = capturedBy === 'ASSUMED_FROM_PLAN' && basis === 'ACTUAL'
          const rejectedByM1 = verdict.verdict === 'REJECTED' && verdict.rejection.rule === 'M1'
          expect(rejectedByM1, `${type} / ${basis} / ${capturedBy}`).toBe(isM1Cell)
          if (rejectedByM1) {
            rejections += 1
            expect(verdict.rejection.code).toBe('ASSUMED_FROM_PLAN_AT_ACTUAL')
          }
        }
      }
    }
    expect(rejections).toBe(ASSERTION_TYPES.length)
  })

  it('forbids the basis and not the method — the same assertion at PLANNED is not an M1 defect', () => {
    // "A plan that nothing contradicted is a plan. It is published at `basis = PLANNED`, and
    // `FactResolved` is what answers 'our best current value'." The departure from
    // `src:omnitracs-roadnet` is about fabricating an observation, not about assuming.
    for (const type of ASSERTION_TYPES) {
      for (const basis of BASES) {
        if (basis === 'ACTUAL') continue
        const verdict = checkCapture({
          type,
          basis,
          capturedBy: 'ASSUMED_FROM_PLAN',
          reasonCount: 0,
        })
        if (verdict.verdict !== 'REJECTED') continue
        expect(verdict.rejection.rule, `${type} at ${basis}`).not.toBe('M1')
      }
    }
  })

  it('reaches a real record through `checkCaptureOf`, not only a projection of one', () => {
    for (const type of ACT_TYPES) {
      const assumed = {
        ...actRecord(type, 'ACTUAL', 'COMPLETED'),
        capturedBy: 'ASSUMED_FROM_PLAN',
      } as unknown as CapturedAssertion<ActType>
      const verdict = checkCaptureOf(assumed)
      expect(verdict.verdict, type).toBe('REJECTED')
      if (verdict.verdict !== 'REJECTED') continue
      expect(verdict.rejection.rule, type).toBe('M1')
    }
  })
})

/* ──────────────────────────  the custody fold  ────────────────────────── */

const GOODS = subjectRef('shipment', shipmentId('S'))
const platform = partyId('platform')
const hauler: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('r-hauler')),
}
const agent: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('r-agent')),
}
const legParty = partyId('leg-performer')

const MOMENTS = ['2026-03-01T08:00:00Z', '2026-03-02T08:00:00Z', '2026-03-03T08:00:00Z'] as const

function handover(
  id: string,
  at: string,
  basis: 'ACTUAL' | 'PLANNED',
  side: HandoverSide,
  index: number,
): CapturedAssertion<'handover'> {
  // Each index is its own **key**, via H-OCCUR's `occurrence` — so three successive transfers
  // between one role pair are three contests and not one, which is [SD §4.7.2f]'s whole point.
  const receiving = index % 2 === 0 ? hauler : agent
  const releasing = index % 2 === 0 ? agent : hauler
  return {
    eventId: eventId(id),
    type: 'handover',
    specVersion: spec,
    subject: GOODS,
    qualifier: { releasing: 'originAgent', receiving: 'hauler', side, occurrence: index + 1 },
    assertedBy: { party: partyId('a'), role: 'originAgent' },
    assertedAt: saidAt,
    capturedBy: 'KEYED_BY_PERSON',
    basis,
    value:
      basis === 'ACTUAL'
        ? {
            occurredAt: instant(at),
            outcome: 'COMPLETED',
            custodyBasis: HANDED_OVER,
            releasingParty: releasing,
            receivingParty: receiving,
          }
        : {
            occurredAt: instant(at),
            custodyBasis: HANDED_OVER,
            releasingParty: releasing,
            receivingParty: receiving,
          },
  } as CapturedAssertion<'handover'>
}

function resolution(
  handoverAssertion: CapturedAssertion<'handover'>,
  selected: string | null,
): FactResolved<'handover'> {
  return {
    eventId: eventId(`fr-${handoverAssertion.eventId}`),
    type: 'FactResolved',
    specVersion: spec,
    subject: GOODS,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: saidAt,
    capturedBy: 'DERIVED_BY_RULE',
    factRef: factRefOf(handoverAssertion),
    selected: selected === null ? null : eventId(selected),
    considered: [handoverAssertion.eventId],
    rule: ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'),
  }
}

/**
 * How one handover appears in an evidence set. Four configurations, crossed over three handovers.
 *
 * The `side` is part of the configuration now, because [SD §4.7.2f] makes it part of the key and
 * because C5's behaviour turns on it: a governing RELEASE yields no holder at all.
 */
const CONFIGURATIONS = ['receipt-selected', 'release-selected', 'not-selected', 'declined'] as const
type Configuration = (typeof CONFIGURATIONS)[number]

function evidenceFor(
  choices: readonly Configuration[],
  basis: 'ACTUAL' | 'PLANNED',
): CustodyEvidence {
  const handovers: CapturedAssertion<'handover'>[] = []
  const resolutions: FactResolved<'handover'>[] = []
  choices.forEach((choice, index) => {
    const at = MOMENTS[index]
    if (at === undefined) return
    const id = `h${index}`
    const side: HandoverSide = choice === 'release-selected' ? 'RELEASE' : 'RECEIPT'
    const record = handover(id, at, basis, side, index)
    handovers.push(record)
    if (choice === 'receipt-selected' || choice === 'release-selected') {
      resolutions.push(resolution(record, id))
    } else if (choice === 'declined') {
      // [A8 §7.3] A8-JOINT: the catalog published a contest and declined to pick a winner.
      resolutions.push(resolution(record, null))
    }
  })
  return { handovers, resolutions, legs: [] }
}

function everyEvidenceSet(basis: 'ACTUAL' | 'PLANNED'): CustodyEvidence[] {
  const sets: CustodyEvidence[] = []
  for (const a of CONFIGURATIONS) {
    for (const b of CONFIGURATIONS) {
      for (const c of CONFIGURATIONS) sets.push(evidenceFor([a, b, c], basis))
    }
  }
  return sets
}

/** Every holder the published evidence could possibly yield — nothing else may be returned. */
function publishedHolders(evidence: CustodyEvidence): CustodyHolder[] {
  return [
    ...evidence.handovers.map((record) => record.value.receivingParty as CustodyHolder),
    ...evidence.legs.map((leg) => ({ kind: 'party', party: leg.performedBy }) as const),
  ]
}

const PROBES = [
  '2026-02-28T00:00:00Z',
  '2026-03-01T08:00:00Z',
  '2026-03-01T12:00:00Z',
  '2026-03-02T08:00:00Z',
  '2026-03-04T00:00:00Z',
] as const

describe('[SD §4.8.3] custodyAt never returns two holders and never invents one', () => {
  const sets = everyEvidenceSet('ACTUAL')

  it('sweeps the whole configuration space rather than a case or two', () => {
    expect(sets.length).toBe(CONFIGURATIONS.length ** 3)
  })

  it('returns exactly one holder, or none, and never a list', () => {
    for (const evidence of sets) {
      for (const probe of PROBES) {
        const answer = custodyAt(GOODS, instant(probe), evidence)
        if (answer.custody === 'UNKNOWN') {
          // Rule 3: "`UNKNOWN` is a real outcome and is **never filled in**." Not a holder of
          // `undefined`, not a holder of `null` — no holder key at all.
          expect(answer).not.toHaveProperty('holder')
          expect(CUSTODY_UNKNOWN_REASONS).toContain(answer.why)
          expect(answer.rule).toEqual(CUSTODY_AT_RULE)
          continue
        }
        // One field, one holder, one of the two declared arms — [SD §4.8.3] returns "the holder",
        // singular, and a fold that could return two would be publishing an unresolved contest as
        // if it were an answer.
        expect(Array.isArray(answer.holder)).toBe(false)
        expect(['partyRole', 'party']).toContain(answer.holder.kind)
        expect(Object.keys(answer.holder)).toHaveLength(2)
      }
    }
  })

  it('returns only a holder the published evidence carries', () => {
    let known = 0
    for (const evidence of sets) {
      const allowed = publishedHolders(evidence).map((holder) => JSON.stringify(holder))
      for (const probe of PROBES) {
        const answer = custodyAt(GOODS, instant(probe), evidence)
        if (answer.custody !== 'KNOWN') continue
        known += 1
        // Rule 1: "The fold reads no field that is not [a published record]." A holder that is not
        // in the inputs is one the projection made up. Note that the inputs are now published
        // records ALL THE WAY DOWN: the named `receivingSides` map is retired ([SD §4.7.2f] §7.2).
        expect(allowed, `at ${probe}`).toContain(JSON.stringify(answer.holder))
      }
    }
    // A property over an empty set is not a property. If the configuration space ever stops
    // producing KNOWN answers, this test would pass while checking nothing.
    expect(known, 'the sweep produced no KNOWN answer to check').toBeGreaterThan(50)
  })

  it('C5 — a governing RELEASE yields UNKNOWN and NEVER the previous holder', () => {
    // This is the sweep's version of A8-NAMED's back door. Under C5 a release closes a span, and
    // "between a `RELEASE` and the next `RECEIPT` the fold returns `UNKNOWN`" — it must not slide
    // to the last party anyone published, which is implicit last-writer-wins by another name.
    let gaps = 0
    for (const evidence of sets) {
      for (const probe of PROBES) {
        const selected = selectedHandovers(evidence).filter(
          (candidate) =>
            candidate.handover.basis === 'ACTUAL' &&
            Date.parse(candidate.handover.value.occurredAt) <= Date.parse(probe),
        )
        if (selected.length === 0) continue
        const latest = Math.max(
          ...selected.map((candidate) => Date.parse(candidate.handover.value.occurredAt)),
        )
        const governing = selected.filter(
          (candidate) => Date.parse(candidate.handover.value.occurredAt) === latest,
        )
        if (!governing.every((candidate) => candidate.handover.qualifier.side === 'RELEASE')) {
          continue
        }
        gaps += 1
        expect(custodyAt(GOODS, instant(probe), evidence), `at ${probe}`).toMatchObject({
          custody: 'UNKNOWN',
          why: 'IN_TRANSFER_GAP',
        })
      }
    }
    expect(gaps, 'the sweep produced no transfer gap to check').toBeGreaterThan(20)
  })

  it('the span always opens at the LATEST governing receipt, never at an earlier one', () => {
    // The fold reads the governing fact, not whichever record happens to be first in the list.
    let checked = 0
    for (const evidence of sets) {
      for (const probe of PROBES) {
        const answer = custodyAt(GOODS, instant(probe), evidence)
        if (answer.custody !== 'KNOWN') continue
        checked += 1
        const laterSelected = selectedHandovers(evidence).filter(
          (candidate) =>
            candidate.handover.basis === 'ACTUAL' &&
            Date.parse(candidate.handover.value.occurredAt) <= Date.parse(probe) &&
            Date.parse(candidate.handover.value.occurredAt) > Date.parse(answer.since),
        )
        expect(laterSelected, `at ${probe}`).toHaveLength(0)
      }
    }
    expect(checked, 'the sweep produced no KNOWN answer to check').toBeGreaterThan(50)
  })

  it('never answers from a plan — a PLANNED handover governs nothing, at any configuration', () => {
    // A PLANNED handover is an intention ([SD §4.2]); folding one would have the projection report
    // custody that nobody has asserted happened. The same argument M1 makes one field over.
    for (const evidence of everyEvidenceSet('PLANNED')) {
      for (const probe of PROBES) {
        expect(custodyAt(GOODS, instant(probe), evidence).custody).toBe('UNKNOWN')
      }
    }
  })

  it('C6 — a tie that disagrees is UNKNOWN; a tie that agrees is one holder', () => {
    // A tie is the case where "two holders" would be tempting, and [SD §4.8.3] publishes no
    // tie-break. [SD §4.7.2f] §7.1's **C6** is the rule that says what happens instead of one: the
    // fold declines. It does not order them by key, by `assertedAt`, by `recordedAt` or by
    // `occurrence` — A8-NAMED ([A8 §4.4]) in its custody-side form.
    const at = '2026-03-01T08:00:00Z'
    const t1 = handover('t1', at, 'ACTUAL', 'RECEIPT', 0)
    const t2 = handover('t2', at, 'ACTUAL', 'RECEIPT', 1)
    expect(sameFactKey(factRefOf(t1), factRefOf(t2))).toBe(false)
    expect(t1.value.receivingParty).not.toEqual(t2.value.receivingParty)
    const tied: CustodyEvidence = {
      handovers: [t1, t2],
      resolutions: [resolution(t1, 't1'), resolution(t2, 't2')],
      legs: [],
    }
    expect(custodyAt(GOODS, instant('2026-03-02T00:00:00Z'), tied)).toEqual({
      custody: 'UNKNOWN',
      why: 'AMBIGUOUS_ORDER_AT_INSTANT',
      rule: CUSTODY_AT_RULE,
    })

    // C6 is about facts that "would open and close differently". Two receipts at one instant that
    // name the SAME holder do not, so the fold still answers — which is what keeps C6 a tie-break
    // refusal rather than a blanket refusal to fold at a shared instant.
    const agreeing = handover('t2', at, 'ACTUAL', 'RECEIPT', 1)
    const concordantT2 = {
      ...agreeing,
      value: { ...agreeing.value, receivingParty: t1.value.receivingParty },
    } as CapturedAssertion<'handover'>
    const concordant: CustodyEvidence = {
      handovers: [t1, concordantT2],
      resolutions: [resolution(t1, 't1'), resolution(concordantT2, 't2')],
      legs: [],
    }
    const answer = custodyAt(GOODS, instant('2026-03-02T00:00:00Z'), concordant)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(t1.value.receivingParty)
  })

  it("takes the leg's declared basis, and the receipt's holder, and still returns one", () => {
    // [SD §4.8.3] rule 1: "where the movement is an `ExternallyPerformedLeg`, that leg's declared
    // `custodyBasis` and `performedBy`". [SD §4.7.2f] §7.1 keeps the basis half and sources the
    // holder from the receipt instead — so `performedBy` no longer has a consumer here. That edge
    // is recorded at the decision's §7.5 and as command C8 in `alloy/custody.als`.
    const leg: ExternallyPerformedLeg = {
      legId: externallyPerformedLegId('L1'),
      moved: GOODS,
      performedBy: legParty,
      custodyBasis: HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY,
      authoritativeAsserter: legParty,
    }
    const viaLeg = handover('h-leg', MOMENTS[0], 'ACTUAL', 'RECEIPT', 0)
    const evidence: CustodyEvidence = {
      handovers: [{ ...viaLeg, context: [subjectRef('externallyPerformedLeg', leg.legId)] }],
      resolutions: [resolution(viaLeg, 'h-leg')],
      legs: [leg],
    }
    const answer = custodyAt(GOODS, instant('2026-03-02T00:00:00Z'), evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(viaLeg.value.receivingParty)
    expect(answer.basis).toBe(HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY)
    expect(publishedHolders(evidence).map((h) => JSON.stringify(h))).toContain(
      JSON.stringify(answer.holder),
    )
  })

  it('is never mistakable for a published record, whichever arm it returns', () => {
    // [SD §4.8]: custody is "never stored, never asserted and never corrected". The answer carries
    // none of [SD §1.1]'s mandatory envelope fields, so it cannot be round-tripped through the
    // capture interface as if it were one.
    const envelopeFields = [
      'eventId',
      'type',
      'specVersion',
      'assertedBy',
      'assertedAt',
      'capturedBy',
      'recordedAt',
      'subject',
    ]
    for (const evidence of sets) {
      for (const probe of PROBES) {
        const answer = custodyAt(GOODS, instant(probe), evidence)
        for (const field of envelopeFields) expect(answer).not.toHaveProperty(field)
      }
    }
  })
})
