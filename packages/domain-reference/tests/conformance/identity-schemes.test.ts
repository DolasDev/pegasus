/**
 * Conformance — A9's decisions, held against the witnessed-scheme table and the vocabulary.
 *
 * The type-level half is `identity-scheme-refuses.ts` — whose directive used to keep `party` out of
 * `AggregateKind` and, since catalog 0.6.4 inverted it, keeps `party` out of `AssertionType`
 * instead; **this sentence said the old thing until [A8 §9 item 3]'s sweep caught it**, which is the
 * `[A8 §9 item 1]` round's own lesson arriving one file further out. Plus `IdentitySchemeStaysOwed`
 * in `src/rules/identity-schemes.ts`, which makes narrowing `SchemeName` a compile failure.
 *
 * Everything here **enumerates rather than counts** ([A1 §9]; [A6 §9]'s reason for it, and
 * [A7 §9]'s, which is the one worth re-reading: A7's draft wrote "four independent publishers"
 * where the table held three, and nothing in its suite could contradict it because nothing was
 * gated). Every assertion below that could have been `toHaveLength` is a `toEqual` over sorted
 * names instead — including the ones this round's own prose gets its numbers from.
 */
import { describe, expect, it } from 'vitest'

import {
  CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK,
  documentIdentitySubject,
  isAggregateKind,
  loadIdentitySchemes,
  partyGrainSchemes,
  schemeAccountability,
  schemeAccountabilityForDId,
  schemeBlocker,
  schemeName,
  type IdentitySchemeStaysOwed,
} from '../../src/index'

import identitySchemes from '../../data/identity-schemes.json'

const table = loadIdentitySchemes(identitySchemes)
const names = (values: readonly { readonly scheme: string }[]): readonly string[] =>
  [...values].map((row) => row.scheme).sort()

/** A mutable deep copy, so a negative case can break one field without breaking the suite. */
function broken(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

type RawScheme = Record<string, unknown>
const rawSchemes = (value: Record<string, unknown>): RawScheme[] => value['schemes'] as RawScheme[]

describe('[A9 §3.2] `identityScheme` is refused, and the refusal is a type', () => {
  it('the gate evaluates to `true`, so `SchemeName` is still the owed code', () => {
    // If a later round narrows `SchemeName` to a union of published members, `Exact<>` becomes
    // `never`, the assignment in `identity-schemes.ts` stops compiling, and this line stops
    // type-checking too. Asserted here as well so the claim is visible to a reader of the suite —
    // the gate itself is the assignment, per [A5 §9].
    const stillOwed: IdentitySchemeStaysOwed = true
    expect(stillOwed).toBe(true)
  })

  it('an arbitrary scheme name is still constructible, which is what "not closed" means', () => {
    // [A9 §3.2]: five sources publish a closed identifier list and every one ships an open slot
    // beside it. A scheme nobody witnesses is legal and unknown, not illegal.
    expect(schemeName('a.scheme.no.source.names')).toBe('a.scheme.no.source.names')
    expect(schemeAccountability(table, schemeName('a.scheme.no.source.names'))).toEqual({
      kind: 'undetermined',
      reason: 'SCHEME_NOT_WITNESSED',
    })
  })
})

describe('[A9 §3.3] the witnessed-scheme table', () => {
  it('names exactly the schemes A9 can cite, and the prose counts nothing this does not', () => {
    expect(names([...table.rows.values()])).toEqual([
      'agentCode',
      'bolCarrier',
      'bolGovernment',
      'equipmentNumber',
      'gbloc',
      'inventoryItemNumber',
      'mcNumber',
      'orderNumber',
      'pro',
      'scac',
      'sealNumber',
      'serviceOrderNumber',
      'shipmentConfirmationNumber',
      'shipmentIdShipper',
      'shipmentRegistrationCarrier',
      'sitControlNumber',
      'tcn',
      'tripNumber',
      'usDotNumber',
      'vanlineRegistration',
    ])
  })

  it('every row cites at least one external source, and no row cites one of ours', () => {
    // [SD §0] / rubric §Scope: our own systems are `role: mapping-only` and are never evidence for
    // what the domain IS. `src:pegasus-cloud-prisma`'s `IntegrationCorrelation`, `src:pegii-longhaul`'s
    // `avl_reg` and `src:pegasus-integration-floors`' `{Brand}:{Number}:{Year}` are all the right
    // shapes and all inadmissible, which [A9 §1] records as the area's scope trap.
    const ours = [
      'pegasus-cloud-domain',
      'pegasus-cloud-prisma',
      'pegasus-integration-floors',
      'pegii-order',
      'pegii-longhaul',
      'equus-sender-legacy',
    ]
    for (const row of table.rows.values()) {
      expect(row.witnesses.length).toBeGreaterThan(0)
      for (const witness of row.witnesses) {
        expect(ours).not.toContain(witness.source)
      }
    }
  })

  it('the three document-accountable schemes are named, and they are the two bill-of-lading regimes plus the PRO', () => {
    // [A6 §3.2(b)] found "one verdict of `DOCUMENT`, and it is the same kind twice" over six
    // DOCUMENT KINDS. A9 runs the same question over SCHEMES and gets a third: `src:nmfta-ebol`'s
    // PRO is "the document identity, in the URL", issuable from a carrier-issued block. Enumerated
    // rather than counted so that the two findings cannot drift apart silently.
    const accountable = [...table.rows.values()].filter((row) => row.documentAccountable === true)
    expect(names(accountable)).toEqual(['bolCarrier', 'bolGovernment', 'pro'])
  })

  it('exactly one witnessed scheme leaves the bit unsettled, and it is the acceptance identifier', () => {
    const unsettled = [...table.rows.values()].filter(
      (row) => row.documentAccountable === 'undetermined',
    )
    expect(names(unsettled)).toEqual(['shipmentConfirmationNumber'])
    expect(schemeAccountability(table, schemeName('shipmentConfirmationNumber'))).toEqual({
      kind: 'undetermined',
      reason: 'SCHEME_WITNESSED_BIT_NOT_PUBLISHED',
    })
  })

  it('the two rows where the issuer is not the vocabulary authority are named', () => {
    // [SD §7.1] argues the `issuer` / `authority` split from `MS2` alone. A9 finds a second,
    // independent case in a different regime — the PRO, drawn by the shipper from a block the
    // carrier issued — so the split now has two witnesses rather than one.
    const split = [...table.rows.values()].filter((row) => !row.issuerIsTheAuthority)
    expect(names(split)).toEqual(['equipmentNumber', 'pro'])
  })

  it('the six rows the corpus names and does not define are named', () => {
    // [A9 §3.3(b)]: `definedNotMerelyNamed` is the column that separates C1 from C2 on this area, and
    // the worst case is `scac` — six witnesses, no definition, because the source that would give
    // one (`src:nmfta-scac`, the only registry entry whose `areas:` is `[A9]` alone) was never
    // fetched and is now `status: skipped` on the 2026-10-04 C1 decision. The row stays here: C1
    // settled that we are not closing this gap by buying the authority's material, not that the
    // corpus now defines the code — which is why this list is unchanged by that decision.
    const named = [...table.rows.values()].filter((row) => !row.definedNotMerelyNamed)
    expect(names(named)).toEqual([
      'mcNumber',
      'orderNumber',
      'scac',
      'sealNumber',
      'tripNumber',
      'usDotNumber',
    ])
  })

  it('exactly two sources are quoted at primary grade, and they are named', () => {
    // [A9 §7]'s statement of the evidence base's weakness, gated by enumeration. Every other
    // citation in the table is a reading of a reading, and a round that later captures one of the
    // DoD sources should fail here and rewrite §7 rather than leave it standing.
    const primary = [
      ...new Set(
        [...table.rows.values()].flatMap((row) =>
          row.witnesses.filter((w) => w.grade === 'primary').map((w) => w.source),
        ),
      ),
    ].sort()
    expect(primary).toEqual(['cfr-49-375', 'milmove-mymove'])
  })

  it('the three DoD sources have no captures and witness these nine rows', () => {
    // [A9 §7]. Enumerated, because [A7 §9]'s defect was a publisher count taken from a row count:
    // there are THREE DoD sources here, not two, and they witness nine rows, not ten.
    const dod = ['dtr-part-iv', 'dp3-400ng', 'dp3-tender-of-service']
    const witnessed = [...table.rows.values()].filter((row) =>
      row.witnesses.some((w) => dod.includes(w.source)),
    )
    expect(names(witnessed)).toEqual([
      'bolGovernment',
      'gbloc',
      'inventoryItemNumber',
      'scac',
      'sealNumber',
      'serviceOrderNumber',
      'sitControlNumber',
      'tcn',
      'usDotNumber',
    ])
    // None of the three is quoted at primary grade anywhere in the table, which is the same claim
    // as "no captures" read from the side the table can see.
    for (const row of table.rows.values()) {
      for (const witness of row.witnesses) {
        if (dod.includes(witness.source)) expect(witness.grade).toBe('secondary')
      }
    }
  })
})

describe('[A9 §3.6] the party-grain schemes have no subject, and the blocker is already owed', () => {
  it('exactly five rows identify a party, and they are named', () => {
    expect(names(partyGrainSchemes(table))).toEqual([
      'agentCode',
      'gbloc',
      'mcNumber',
      'scac',
      'usDotNumber',
    ])
  })

  it('carries NO blocker on any row, because [A8 §9 item 1] minted the party', () => {
    // INVERTED at [A8 §9 item 1] (catalog 0.6.4), and the old assertion is kept in the comment
    // because the inversion is the deliverable. It used to read: a `party` row must carry
    // '[A8 §9 item 1]' and every other row must carry null. The party is a subject now, so all
    // five blockers came off and the invariant is one-sided. Changed deliberately, not loosened —
    // `loadIdentitySchemes` fails if the blocker is written back onto ANY row, which the tamper
    // test below exercises.
    for (const row of table.rows.values()) {
      expect(schemeBlocker(table, schemeName(row.scheme)), row.scheme).toBeNull()
    }
  })

  it('still identifies a party on exactly the five rows, which is what got a subject', () => {
    // The five are unchanged by the mint; what changed is that `party` is now an aggregate kind
    // like `document`, so these rows are ordinary rather than blocked.
    for (const row of partyGrainSchemes(table)) {
      expect(row.identifies, row.scheme).toBe('party')
      expect(isAggregateKind(row.identifies), row.scheme).toBe(true)
    }
  })

  it('SCAC is the widest-witnessed row, and its six witnesses are four publishing bodies', () => {
    // [A7 §9]'s defect, pre-empted: the row count is not the publisher count. `dtr-part-iv` and
    // `dp3-400ng` are both DoD, and `stedi-x12-reference` and `x12-212-trailer-manifest` are two
    // readings of X12. Both numbers the prose uses are gated here.
    const scac = table.rows.get('scac')
    expect(scac).toBeDefined()
    expect([...(scac?.witnesses ?? [])].map((w) => w.source).sort()).toEqual([
      'dp3-400ng',
      'dtr-part-iv',
      'nmfta-ebol',
      'project44',
      'stedi-x12-reference',
      'x12-212-trailer-manifest',
    ])
    const widest = Math.max(...[...table.rows.values()].map((row) => row.witnesses.length))
    expect(scac?.witnesses.length).toBe(widest)
  })

  it('the loader refuses [A8 §9 item 1] written back onto a PARTY-grain row', () => {
    // The direction this inverted to. Before catalog 0.6.4 the tamper was taking the blocker OFF
    // `scac`; now it is putting it back, and `party` is the grain that used to be exempt.
    const tampered = broken(identitySchemes)
    const row = rawSchemes(tampered).find((entry) => entry['scheme'] === 'scac')
    expect(row).toBeDefined()
    if (row) row['blocker'] = '[A8 §9 item 1] — no party entity'
    expect(() => loadIdentitySchemes(tampered)).toThrow(/scac identifies a party/)
  })

  it('the loader refuses [A8 §9 item 1] written onto an aggregate-grain row', () => {
    const tampered = broken(identitySchemes)
    const row = rawSchemes(tampered).find((entry) => entry['scheme'] === 'tcn')
    expect(row).toBeDefined()
    if (row) row['blocker'] = '[A8 §9 item 1] — no party entity'
    expect(() => loadIdentitySchemes(tampered)).toThrow(/tcn identifies a shipment/)
  })

  it('the loader refuses a document-accountable scheme that does not identify a document', () => {
    // [A6 §3.2] defines the bit as "assigned to the form, independently of any shipment", so this
    // pair is a contradiction rather than a row.
    const tampered = broken(identitySchemes)
    const row = rawSchemes(tampered).find((entry) => entry['scheme'] === 'tcn')
    expect(row).toBeDefined()
    if (row) row['documentAccountable'] = true
    expect(() => loadIdentitySchemes(tampered)).toThrow(/does not identify a document/)
  })
})

describe('[A8 §9 item 3] what grain a party may be is declared by what identifies it', () => {
  // The branch grain was [A8 §9 item 1]'s third residue, and item 3 closed it on 2026-10-09 WITHOUT
  // a field, by reading two rows this table already carried. These assertions are the evidence, not
  // a restatement: if a later round mints an `office` or `branch` aggregate kind and re-points
  // either row, or edits the witness out, they fail and send it to `AsserterGrainIsNotOnTheEnvelope`
  // and the two reasons there.
  const defined = () => partyGrainSchemes(table).filter((row) => row.definedNotMerelyNamed)

  it('the two party-grain rows the corpus DEFINES are the office and the branch', () => {
    expect(names(defined())).toEqual(['agentCode', 'gbloc'])
  })

  it('`gbloc` identifies an OFFICE, which is why a branch is a party', () => {
    const gbloc = table.rows.get('gbloc')
    expect(gbloc?.identifies).toBe('party')
    // `src:dtr-part-iv`, quoted in the row: "BLOC — Bill of Lading Office Code; the identity of the
    // OFFICE, and the scope unit for suspensions and blackouts". The party grain reaches below the
    // legal entity, and the identifier is what says so.
    expect(gbloc?.witnesses.some((w) => w.citation.includes('the identity of the OFFICE'))).toBe(
      true,
    )
  })

  it('`agentCode` CARRIES the branch in the identifier, so no field has to', () => {
    const agentCode = table.rows.get('agentCode')
    expect(agentCode?.identifies).toBe('party')
    expect(
      agentCode?.witnesses.some((w) =>
        w.citation.includes(
          '7-digit hierarchical agent id whose trailing three digits are the branch',
        ),
      ),
    ).toBe(true)
  })

  it('and NOT ONE of the twenty witnessed schemes identifies a natural person', () => {
    // The other half of the decision, and the half that could silently stop being true. Every row's
    // `identifies` is an [SD §1.2] aggregate kind, and the enum has no person member — so a
    // person-grain identifier would have to arrive as a new kind, which
    // `tests/conformance/party-grain-refuses.ts` refuses at compile time. Enumerated rather than
    // counted ([A1 §9]): the five party rows are named above, and these are the grains the rest sit
    // at.
    expect([...new Set([...table.rows.values()].map((row) => row.identifies))].sort()).toEqual([
      'document',
      'item',
      'order',
      'party',
      'resource',
      'shipment',
      'stay',
      'trip',
    ])
  })
})

describe('[A9 §Cross-area] to [A6] — I-ACCOUNT supplies D-ID its input and removes no branch', () => {
  it('a witnessed accountable scheme now reaches D-ID as `DOCUMENT`', () => {
    expect(
      documentIdentitySubject(schemeAccountabilityForDId(table, schemeName('bolCarrier'))),
    ).toEqual({ kind: 'determined', subject: 'DOCUMENT' })
  })

  it('a witnessed carried scheme reaches it as `CARRIED_SUBJECT`', () => {
    expect(
      documentIdentitySubject(
        schemeAccountabilityForDId(table, schemeName('shipmentRegistrationCarrier')),
      ),
    ).toEqual({ kind: 'determined', subject: 'CARRIED_SUBJECT' })
  })

  it("D-ID's `undetermined` branch stays reachable, and [A9 §3.2] is why it stays reachable forever", () => {
    // [A6 §3.2(a)]'s branch is not removed and cannot be: while `identityScheme` is open, a scheme
    // outside the table is always possible. Both of A9's `undetermined` reasons collapse into the
    // one D-ID publishes, which is correct for each.
    for (const scheme of ['a.scheme.no.source.names', 'shipmentConfirmationNumber']) {
      expect(
        documentIdentitySubject(schemeAccountabilityForDId(table, schemeName(scheme))),
      ).toEqual({ kind: 'undetermined', reason: 'SCHEME_ACCOUNTABILITY_NOT_PUBLISHED' })
    }
  })

  it('the three placeholder schemes the existing tests use are now witnessed or deliberately not', () => {
    // `car-on-a-separate-carrier.test.ts` calls `vanline.registration` and `autocarrier.pro`
    // "placeholders" because the vocabulary was owed; `document-identity-and-evidence.test.ts`
    // uses `carrierBol`. [A9 §3.2] leaves the vocabulary owed, so the placeholders stay legal —
    // and the table names the same three schemes under the spellings A9 chose, which is why the
    // scenario tests are UNCHANGED by this round. Recorded so that a reader who expects them to
    // have been renamed finds the reason here.
    expect(table.rows.has('vanlineRegistration')).toBe(true)
    expect(table.rows.has('bolCarrier')).toBe(true)
    expect(table.rows.has('pro')).toBe(true)
    expect(schemeAccountability(table, schemeName('vanline.registration'))).toEqual({
      kind: 'undetermined',
      reason: 'SCHEME_NOT_WITNESSED',
    })
  })
})

describe('[A9 §3.8] the rubric `Covers` column is a prompt, and the residue runs both ways', () => {
  it("the rubric's five names map onto exactly these rows", () => {
    // `rubric.md`'s A9 row reads "order no., registration no., SCAC, BOL/PRO, service order no.".
    // Three of the five turn out to name more than one scheme, because a scheme is (name +
    // authority) under [SD §7.1] and the column has only names.
    const covered = [...table.rows.values()].filter((row) => row.rubricCovers !== null)
    expect(names(covered)).toEqual([
      'bolCarrier',
      'bolGovernment',
      'orderNumber',
      'pro',
      'scac',
      'serviceOrderNumber',
      'shipmentRegistrationCarrier',
      'vanlineRegistration',
    ])
    expect([...new Set(covered.map((row) => row.rubricCovers))].sort()).toEqual([
      'BOL/PRO',
      'SCAC',
      'order no.',
      'registration no.',
      'service order no.',
    ])
  })

  it('the schemes the corpus names that the rubric does not are enumerated', () => {
    // The other half of the residue, and the half [A6 §3.8] and [A7 §9] warn about: a reader who
    // took the `Covers` column for an inventory would miss every constructed scheme, every
    // item-, resource- and stay-grain scheme, and the acceptance identifier.
    const uncovered = [...table.rows.values()].filter((row) => row.rubricCovers === null)
    expect(names(uncovered)).toEqual([
      'agentCode',
      'equipmentNumber',
      'gbloc',
      'inventoryItemNumber',
      'mcNumber',
      'sealNumber',
      'shipmentConfirmationNumber',
      'shipmentIdShipper',
      'sitControlNumber',
      'tcn',
      'tripNumber',
      'usDotNumber',
    ])
  })

  it('"registration no." names two schemes with different authorities, and one has a single witness', () => {
    // The round's sharpest row. `src:cfr-49-375` §375.505(b)(16)'s carrier-assigned registration
    // number and `src:sirva-ade`'s Brand + RegNumber + RegYear are two vocabularies under I-KEY,
    // and the van-line one — the genuinely HHG-specific half of the rubric's five — has exactly
    // one external witness in the whole corpus, secondary, with no capture.
    const vanline = table.rows.get('vanlineRegistration')
    const carrier = table.rows.get('shipmentRegistrationCarrier')
    expect(vanline?.rubricCovers).toBe('registration no.')
    expect(carrier?.rubricCovers).toBe('registration no.')
    expect([...(vanline?.witnesses ?? [])].map((w) => `${w.source}/${w.grade}`)).toEqual([
      'sirva-ade/secondary',
    ])
    expect([...(carrier?.witnesses ?? [])].map((w) => `${w.source}/${w.grade}`)).toEqual([
      'cfr-49-375/primary',
    ])
    expect(vanline?.authority).not.toBe(carrier?.authority)
  })
})

describe('[A9 §3.5] a correlation is an obligation, not a link', () => {
  it('is recorded as a plain value, and [A6 §9] says why it is not a gate', () => {
    // The contrasting case sits one screen up: `IdentitySchemeStaysOwed` IS a gate, because its
    // claim has an edge the types can see. This one becomes false only if a correlation FIELD is
    // added, which touches [SD §7] and the emitted schemas and moves nothing in this module.
    expect(CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK).toBe(true)
  })
})
