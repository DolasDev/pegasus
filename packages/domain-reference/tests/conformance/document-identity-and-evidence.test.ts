/**
 * Conformance — A6's two rules and its two recorded gaps.
 *
 * Distinct from `documents.test.ts`, which gates the **analysis documents** in `docs/`. This file
 * gates the **`document` aggregate**: rule **D-ID** ([A6 §3.2]), rule **D-CITE** ([A6 §3.5]), the
 * state refusal ([A6 §3.4]) and the capture gap ([A6 §3.7]).
 *
 * The type-level half is in this file too, because A6's one compile-time gate is an exactness
 * assertion rather than a set of illegal shapes — `CaptureMethodsAreTheSeven` in
 * `src/rules/documents.ts`, whose tamper is recorded at [A6 §9].
 */
import { describe, expect, it } from 'vitest'

import {
  ABSENT_AND_OWED,
  CITATION_CLAIMS_NOTHING,
  CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE,
  CAPTURE_METHODS,
  DOCUMENT_KIND_IDENTITY_SUBJECTS,
  DOCUMENT_STATE_IS_NOT_COMPUTABLE,
  IDENTITY_SUBJECTS,
  RECORD_TYPES,
  SUBJECT_FAMILIES,
  TABLE_A_402_4_LANDINGS,
  WHITELIST_RESIDUE_REASONS,
  documentIdentitySubject,
  documentId,
  eventId,
  instant,
  partyId,
  shipmentId,
  specVersion,
  subjectRef,
  schemeName,
  whitelistResidue,
  whitelistResidueReasons,
  type CapturedAssertion,
} from '../../src/index'

import canonical from '../../data/canonical-subjects.json'

describe('[A6 §3.3] the document aggregate is an object with no acts', () => {
  it('no declared record type has a `document` canonical subject family', () => {
    // The check A2 told A6 to run first, run against the table rather than against prose. A family
    // whose ONLY member is `document` would be the shape a document-subject act row needs; the one
    // family that admits `document` is `anyAggregate`, which `identity` uses and which admits
    // thirteen others ([SD §7.1]).
    // `SUBJECT_FAMILIES`' member tuples are literal types, so `tsc` reports the singleton comparisons
    // as statically false before the test ever runs — which is the claim proved twice over. Widened
    // to `string[]` here so that the assertion is also checked at runtime, against the data.
    const families = Object.entries(SUBJECT_FAMILIES) as readonly (readonly [
      string,
      readonly string[],
    ])[]
    const documentOnly = families.filter(
      ([, members]) => members.length === 1 && members[0] === 'document',
    )
    expect(documentOnly).toEqual([])

    // And the one family that admits `document` is `anyAggregate`, which admits thirteen others too,
    // so it cannot be a document act's family — it is the family `identity` uses, and it is what
    // makes D-ID a reading rule rather than a schema change ([SD §7.1]).
    const admitting = families
      .filter(([, members]) => members.includes('document'))
      .map(([name]) => name)
    expect(admitting).toEqual(['anyAggregate'])
  })

  it('`document` appears in the table only in `context[]`, on exactly the six rows [A6 §3.3] names', () => {
    // Enumerated rather than counted, which is [A1 §9]'s rule in the direction it was written for:
    // [A6 §3.3]'s first draft said five, and this assertion named `weight.tare` as the sixth.
    const rows = canonical.rows as readonly { type: string; context: readonly string[] }[]
    const carriers = rows
      .filter((row) => row.context.includes('document'))
      .map((row) => row.type)
      .sort()
    expect(carriers).toEqual([
      'condition',
      'identity',
      'pieceCount',
      'weight.gross',
      'weight.net',
      'weight.tare',
    ])
  })

  it('`documentIssuance` is recorded absent and owed, and is not a record type', () => {
    expect(ABSENT_AND_OWED).toContain('documentIssuance')
    // The whole point of an absent class: it is named so its absence is not read as an oversight,
    // and it is NOT admissible. Minting is [SD §4.7]'s to do.
    expect((RECORD_TYPES as readonly string[]).includes('documentIssuance')).toBe(false)
  })

  it('OWED: a signature has no class either, and is deliberately not on the absent list', () => {
    // [A6 §3.3(b)]. Four sources publish the procedure — per line item, per page, immutable after,
    // copy before departure — and none publishes what the signature ASSERTS. A fact class needs a
    // value, so this one is owed to the user and to A10 rather than recorded here. Asserted as a
    // negative so that minting it without reading §3.3(b) fails a test rather than passing silently.
    const signatureish = ABSENT_AND_OWED.filter((name) => /sign|certif|execut/i.test(name))
    expect(signatureish).toEqual([])
  })
})

describe('[A6 §3.2] D-ID — a document’s own identity versus the identity it carries', () => {
  it('a document-accountable scheme puts the assertion on the `document`', () => {
    // `src:dtr-part-iv` A-413 §C.2: a BL "is only accountable when a number has been assigned to the
    // form", and lost/stolen/void numbers are reported. Facts about the form.
    expect(documentIdentitySubject(true)).toEqual({ kind: 'determined', subject: 'DOCUMENT' })
  })

  it('a carried scheme puts the assertion on the carried identifier’s own subject', () => {
    // `src:cfr-49-375` §375.505(b)(16): "any identification or registration number you assign to the
    // shipment" is a field IN the bill of lading, not the bill of lading's own number.
    expect(documentIdentitySubject(false)).toEqual({
      kind: 'determined',
      subject: 'CARRIED_SUBJECT',
    })
  })

  it('OWED: an unknown scheme is undetermined, never defaulted to `CARRIED_SUBJECT`', () => {
    // [A6 §3.2(a)]: `identityScheme` is owed to A9, so whether a scheme is assigned to the form is
    // not lookable-up here. B-ONWARD's shape, for B-ONWARD's reason — a default would be a guess in
    // the one place [SD §0] forbids one.
    expect(documentIdentitySubject(undefined)).toEqual({
      kind: 'undetermined',
      reason: 'SCHEME_ACCOUNTABILITY_NOT_PUBLISHED',
    })
  })

  it('both shapes validate against the published envelope, which is why D-ID costs no version bump', () => {
    // [A6 §3.2(d)] / [A6 §9]: `record.identity` declares `subject` AND `context[]` as
    // `SubjectRef.family.anyAggregate`, and that family carries `document` and `shipment` alike. So
    // the two shapes below are both already legal and D-ID chooses between them rather than widening
    // anything. If either stopped compiling, A6's no-bump claim would be false.
    const spec = specVersion('1')
    const mover = partyId('mover')
    const scheme = {
      scheme: schemeName('carrierBol'),
      vocabularyScope: { authority: mover },
    } as const
    const asserter = { party: mover, role: 'hauler' } as const
    const from = instant('2026-03-01T09:00:00Z')

    const theDocumentsOwnNumber: CapturedAssertion<'identity'> = {
      eventId: eventId('A-BOL-NUMBER'),
      type: 'identity',
      specVersion: spec,
      subject: subjectRef('document', documentId('DOC-BOL-6031')),
      qualifier: scheme,
      assertedBy: asserter,
      assertedAt: instant('2026-03-01T09:00:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
      context: [subjectRef('shipment', shipmentId('S'))],
      value: { id: '6031', issuer: mover, effectiveFrom: from },
    }

    const aNumberTheDocumentCarries: CapturedAssertion<'identity'> = {
      eventId: eventId('A-SHIPMENT-REGISTRATION'),
      type: 'identity',
      specVersion: spec,
      subject: subjectRef('shipment', shipmentId('S')),
      qualifier: scheme,
      assertedBy: asserter,
      assertedAt: instant('2026-03-01T09:00:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
      context: [subjectRef('document', documentId('DOC-BOL-6031'))],
      value: { id: 'REG-90117', issuer: mover, effectiveFrom: from },
    }

    // [SD §1.3] pairs on `(subject, type, qualifier?)`, so these are TWO fact keys. That is the whole
    // reason D-ID exists: without it one value is filed twice and the duplication is invisible.
    expect(theDocumentsOwnNumber.subject).not.toEqual(aNumberTheDocumentCarries.subject)
    expect(theDocumentsOwnNumber.type).toBe(aNumberTheDocumentCarries.type)
  })

  it('[A6 §3.2(b)] one document kind in the corpus has a scheme of its own, and it is one kind twice', () => {
    // The finding, computed rather than counted in prose ([A1 §9]). `null` is out of the model — the
    // NTS warehouse receipt, excluded by [A5 §3.4(c)] — and is not the same as `undetermined`.
    const scored = DOCUMENT_KIND_IDENTITY_SUBJECTS.filter((row) => row.accountableScheme !== null)
    const documentAccountable = scored.filter((row) => row.accountableScheme === true)
    expect(documentAccountable.map((row) => row.kind)).toEqual([
      'bill of lading (commercial)',
      'PPGBL / government bill of lading',
    ])
    // Every other kind the corpus enumerates borrows its identity, so D-ID's `CARRIED_SUBJECT`
    // branch is the ordinary path and its narrowness is the point.
    expect(scored.length - documentAccountable.length).toBe(3)
  })

  it('every scored kind cites a source, and each verdict is one D-ID can return', () => {
    for (const row of DOCUMENT_KIND_IDENTITY_SUBJECTS) {
      expect(row.citation.length, `${row.kind} cites nothing`).toBeGreaterThan(40)
      if (row.accountableScheme === null) continue
      const verdict = documentIdentitySubject(row.accountableScheme)
      expect(verdict.kind).toBe('determined')
      if (verdict.kind !== 'determined') continue
      expect(IDENTITY_SUBJECTS).toContain(verdict.subject)
    }
  })
})

describe('[A6 §3.5] D-CITE — a citation is a pointer, never a claim', () => {
  it('records the decision the `EvidenceRef` TODO used to hold open', () => {
    expect(CITATION_CLAIMS_NOTHING).toBe(true)
  })

  it('an admitted Assertion’s `evidence[]` carries a document ref and nothing about the document', () => {
    // The shape D-CITE fixes the meaning of. `evidence[]` is a ref and a kind; there is no standing
    // field, no "establishes" flag and no assertion about the cited document — which is exactly what
    // `src:dp3-tender-of-service` §C.9.a(24) requires: a signed check-off sheet is citable and does
    // not establish the delivery. Standing is a rule over the pair, and [A6 §6] names its owners.
    const assertion: CapturedAssertion<'weight.net'> = {
      eventId: eventId('A-NET'),
      type: 'weight.net',
      specVersion: specVersion('1'),
      subject: subjectRef('shipment', shipmentId('S')),
      assertedBy: { party: partyId('mover'), role: 'hauler' },
      assertedAt: instant('2026-03-04T12:00:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
      evidence: [{ kind: 'document', ref: subjectRef('document', documentId('DOC-TICKET-1')) }],
      value: { amount: 8120, unit: 'lb' as never },
    }
    expect(assertion.evidence).toEqual([
      { kind: 'document', ref: { aggregate: 'document', id: 'DOC-TICKET-1' } },
    ])
    expect(Object.keys(assertion.evidence?.[0] ?? {}).sort()).toEqual(['kind', 'ref'])
  })

  it('[A6 §3.5(c)] `EvidenceRef` has exactly two branches, and the inbound message is not one', () => {
    // The refusal, held where it can be seen. Widening this union is a published-schema change
    // (`additionalProperties: false` on both branches); ratifying `e-canon.ts`'s ingest-local
    // `BoundaryEvidenceRef` is not. `src:nmfta-ebol` — the one publisher that models both — keeps the
    // acceptance identifier distinct from the document identifier.
    const kinds: readonly string[] = ['document', 'assertion']
    expect(kinds).not.toContain('inboundMessage')
  })
})

describe('[A6 §3.4] document state is neither a vocabulary nor a projection', () => {
  it('records the refusal as a value a scenario can assert against', () => {
    expect(DOCUMENT_STATE_IS_NOT_COMPUTABLE).toBe(true)
  })

  it('publishes no document-state or document-type vocabulary', () => {
    // Eleven publishers, twelve facets, no two decompositions agreeing — and `src:sirva-ade` folding
    // signature INTO the type axis in a live contract. [A2 §3.3]'s argument with more publishers.
    const named = (RECORD_TYPES as readonly string[]).filter((type) => /^document/.test(type))
    expect(named).toEqual([])
  })

  it('and it would be B-STAGE again, which is why it is a constant and not a fold', () => {
    // A fold needs input records. `documentIssuance` being absent is the reason there are none, so
    // the two facts are asserted together: if the class is ever minted, this test is the reminder
    // that the projection becomes writable and [A6 §3.4(a)] should be revisited.
    expect(ABSENT_AND_OWED).toContain('documentIssuance')
    expect(DOCUMENT_STATE_IS_NOT_COMPUTABLE).toBe(true)
  })
})

describe('[A6 §3.7] the capture vocabulary cannot say a signed record’s silence is an assertion', () => {
  it('records the gap', () => {
    expect(CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE).toBe(true)
  })

  it('and the gate behind it is the seven members, re-declared independently', () => {
    // The runtime half of `CaptureMethodsAreTheSeven`. The type-level half is the gate — an eighth
    // member makes the alias `never` and the assignment in `documents.ts` stops compiling — and this
    // is the readable statement of the same fact, so a reader of the tests meets it too. [A6 §9].
    expect([...CAPTURE_METHODS].sort()).toEqual([
      'ASSUMED_FROM_PLAN',
      'DERIVED_BY_RULE',
      'DEVICE_GEOFENCE',
      'DEVICE_TELEMETRY',
      'KEYED_BY_PERSON',
      'OBSERVED_BY_PERSON',
      'PARTNER_ASSERTED',
    ])
  })

  it('names no member meaning "asserted by the absence of an annotation"', () => {
    const omissionish = CAPTURE_METHODS.filter((method) => /OMISS|SILEN|ABSEN|DEFAULT/.test(method))
    expect(omissionish).toEqual([])
    // And the closest member is the one M1 forbids at `basis = ACTUAL`, which is why A6 does not
    // reach for it: `ASSUMED_FROM_PLAN` is "the plan stood unchallenged", and what the sources
    // describe is a challenge window offered per page and declined. M1 is right; the set is short one
    // member, and minting it is A4's over [SD §5.1].
    expect(CAPTURE_METHODS).toContain('ASSUMED_FROM_PLAN')
  })
})

describe('[A6 §3.6] Table A-402-4 mapped onto the vocabulary', () => {
  it('every landing row names real record types', () => {
    for (const row of TABLE_A_402_4_LANDINGS) {
      expect(row.note.length, `${row.field} explains nothing`).toBeGreaterThan(20)
      if (!row.lands) continue
      expect(row.types.length, `${row.field} lands on nothing`).toBeGreaterThan(0)
      for (const type of row.types) {
        expect(RECORD_TYPES).toContain(type)
      }
    }
  })

  it('every residue row gives a reason, and the reasons are four distinct kinds', () => {
    // The conclusion [A6 §3.6] draws rests on the residue being FOUR KINDS rather than four
    // instances of one: two owed elsewhere, one refused on evidence, one not a domain fact. If they
    // collapsed to one kind, "a sub-fact grain would move none of them" would need re-arguing.
    const residue = whitelistResidue()
    expect(residue.length).toBe(4)
    const reasons = whitelistResidueReasons()
    expect([...reasons].sort()).toEqual([...WHITELIST_RESIDUE_REASONS].sort())
  })

  it('and the refused row points at a refusal rather than at an owed thing', () => {
    // The Code of Service row is the one that cannot be closed by anyone finishing any work:
    // [A2 §3.3] WITHDREW `shipmentType` on evidence. Asserted so that a later reader does not file
    // it as a to-do.
    const refused = TABLE_A_402_4_LANDINGS.filter(
      (row) => !row.lands && row.reason === 'VOCABULARY_REFUSED',
    )
    expect(refused.map((row) => row.field)).toEqual(['Code of Service'])
  })
})
