/**
 * Conformance — A7's decisions, held against the tables and the vocabulary.
 *
 * The type-level half is `charge-collection-refuses.ts`, whose `@ts-expect-error` directives keep
 * `invoice`, `payment` and `chargeCollection` illegal, and `ChargeAspectsAreTheThree` in
 * `src/rules/charges.ts`, which keeps a fourth `{aspect}` member from compiling.
 *
 * Everything here **enumerates rather than counts** ([A1 §9], and [A6 §9]'s reason for it: A6's own
 * prose said five where the answer was six, and a count-only assertion would have passed a wrong
 * number). Every assertion below that could have been `toHaveLength` is a `toEqual` over sorted
 * names instead.
 */
import { describe, expect, it } from 'vitest'

import {
  ABSENT_AND_OWED,
  CHARGE_STATE_IS_NOT_COMPUTABLE,
  COLLECTABILITY_IS_A_RULE_OVER_PAIRS,
  COLLECTION_PRECONDITION_SUBJECTS,
  FINANCIAL_FACT_CLASSES,
  RECORD_TYPES,
  loadCollectionPreconditions,
  type ChargeAspectsAreTheThree,
} from '../../src/index'

import canonicalSubjects from '../../data/canonical-subjects.json'
import collectionPreconditions from '../../data/collection-preconditions.json'

type CanonicalRow = {
  readonly type: string
  readonly family: string
  readonly context: readonly string[]
  readonly qualifier: { readonly values?: Record<string, readonly string[]> | null } | null
  readonly authority: { readonly status: string; readonly boundBy?: string | null }
}

const rows = canonicalSubjects.rows as readonly CanonicalRow[]
const chargeRow = rows.find((row) => row.type === 'charge')

/** A mutable deep copy, so a negative case can break one field without breaking the suite. */
function broken(table: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(table)) as Record<string, unknown>
}

describe('[A7 §3.2] no act on a charge has a record, and the subject is the blocker', () => {
  it('exactly one type has the `charge` family, and it is the money fact itself', () => {
    // The A2/A6 check, a third aggregate over. Enumerated by name so that minting an act ON a
    // charge — billed, collected, paid, disputed, denied, set off — fails here rather than
    // silently widening the area. [A2 §3.6] instructed A6, A7 and A9 each to run this.
    const chargeSubjects = rows
      .filter((row) => row.family === 'charge')
      .map((row) => row.type)
      .sort()
    expect(chargeSubjects).toEqual(['charge'])
  })

  it('`chargeCollection` is recorded absent and owed, and is not a record type', () => {
    expect(ABSENT_AND_OWED).toContain('chargeCollection')
    expect((RECORD_TYPES as readonly string[]).includes('chargeCollection')).toBe(false)
  })

  it('OWED: no collection-side act is on the absent list under any other spelling', () => {
    // Asserted as a negative for `document-identity-and-evidence.test.ts`'s reason: minting a
    // second collection class without reading §3.2 should fail a test rather than pass silently.
    // `chargeCollection` is the one A7 recorded; anything else matching is somebody's shortcut.
    const collectionish = ABSENT_AND_OWED.filter((name) =>
      /invoice|payment|billing|settle|collect/i.test(name),
    )
    expect(collectionish).toEqual(['chargeCollection'])
  })

  it('the aspects are the three [SD §4.7.2b] declares, in the table and in the type', () => {
    // Two independently written spellings of one closed set — which is what makes
    // `ChargeAspectsAreTheThree` in `src/rules/charges.ts` a gate and not [A2 §9]'s tautology.
    // This is the table half; the type half is the `Exact<>` and its assignment.
    expect(chargeRow?.qualifier?.values?.['aspect']).toEqual(['PROPOSED', 'DECIDED', 'RATED'])
    const aspectsAreTheThree: ChargeAspectsAreTheThree = true
    expect(aspectsAreTheThree).toBe(true)
  })

  it('[A7 §1] `charge`s authority is ASSIGNED, which is what the plan did not credit', () => {
    // A7 is the first area since A4 whose subject arrives with its authority settled, and that is
    // why §3.2's gap is somewhere else entirely. Asserted so that an A8 revision that re-opens
    // row 11 has to come past [A7 §1].
    expect(chargeRow?.authority.status).toBe('assigned')
    expect(chargeRow?.authority.boundBy).toBe('PRINCIPAL')
  })
})

describe('[A7 §3.4] the scoping is declared, and it is not the taxonomy', () => {
  it('`charge`s `context[]` is the six members the four inbound hand-offs need', () => {
    // [A1]'s order-scoped proposal, [A2]'s portion-scoped storage minimum, [A3]'s stop-caused
    // accessorial and [A5]'s whole storage surface are all already expressible. Enumerated so that
    // "no inbound hand-off needs a new mechanism" is checked rather than asserted.
    expect([...(chargeRow?.context ?? [])].sort()).toEqual([
      'order',
      'portion',
      'shipment',
      'stay',
      'stop',
      'stopAction',
    ])
  })

  it('and `trip` is NOT among them, which is [A8 §9 item 7]s line drawn by the table', () => {
    // Revenue allocation between agents is A13's and "row 11 must not be read as settling it".
    // `src:alvys-api`'s cost side — `Carrier.Rate`, `TripValue`, `Driver1.RatesV2[]` — hangs off the
    // trip and so has no home here. [A7 §1] records this as a corroboration, not a decision: the
    // assertion says the table and A8 agree, not that either is right.
    expect(chargeRow?.context).not.toContain('trip')
  })
})

describe('[A7 §3.7] A-COLLECT — collectability is a rule over pairs', () => {
  const table = loadCollectionPreconditions(collectionPreconditions)

  it('names every published precondition, with the aggregate its gating fact is about', () => {
    // The enumerating gate. A row added or removed fails by NAME, and — the point of the table —
    // so does a row whose gating fact silently changes which aggregate it is about.
    const byId = [...table.rows.values()].map((row) => `${row.id} -> ${row.gatingFactAbout}`).sort()
    expect(byId).toEqual([
      'ACCESSORIALS_DETERMINED_BEFORE_THE_BILL_OF_LADING -> shipment',
      'DOCUMENT_PACKAGE_TO_THE_PPSO_WITHIN_SEVEN_GBD -> document',
      'NO_INVOICING_BEFORE_THE_REWEIGH_IS_RECORDED -> shipment',
      'SIT_DENIED_FOR_WANT_OF_THE_TWENTY_FOUR_HOUR_NOTICE -> shipment',
      'THIRD_PARTY_CHARGES_NEED_A_RECEIPT_AND_A_PRE_APPROVAL -> document',
      'TOTAL_LOSS_COLLECTS_NOTHING -> shipment',
      'WEIGHT_TICKETS_WITH_THE_FREIGHT_BILL -> document',
    ])
    expect(COLLECTABILITY_IS_A_RULE_OVER_PAIRS).toBe(true)
  })

  it('the gating fact is NOT always a document, which is what generalises [A6 §3.5]s pair', () => {
    // D-CITE scopes evidentiary standing to a (document kind, fact class) pair. If every row here
    // were a document, A-COLLECT would be D-CITE restated and would not be worth a name. Four of
    // the seven are not, and this assertion is the whole argument for the rule existing.
    const kinds = [...new Set([...table.rows.values()].map((row) => row.gatingFactAbout))].sort()
    expect(kinds).toEqual(['document', 'shipment'])
    expect([...COLLECTION_PRECONDITION_SUBJECTS].sort()).toEqual(kinds)
    const notDocuments = [...table.rows.values()].filter(
      (row) => row.gatingFactAbout !== 'document',
    )
    expect(notDocuments.map((row) => row.id).sort()).toEqual([
      'ACCESSORIALS_DETERMINED_BEFORE_THE_BILL_OF_LADING',
      'NO_INVOICING_BEFORE_THE_REWEIGH_IS_RECORDED',
      'SIT_DENIED_FOR_WANT_OF_THE_TWENTY_FOUR_HOUR_NOTICE',
      'TOTAL_LOSS_COLLECTS_NOTHING',
    ])
  })

  it('names which rows are PRIMARY, because [A7 §0] item 4 makes the rest secondary', () => {
    // Only `src:cfr-49-375` among these sources has a `captured/` directory, so only its rows are
    // primary text. Enumerated so that a later reader cannot upgrade a secondary quotation by
    // editing one boolean without the test naming the row.
    const primary = [...table.rows.values()]
      .filter((row) => row.primary)
      .map((row) => row.id)
      .sort()
    expect(primary).toEqual([
      'ACCESSORIALS_DETERMINED_BEFORE_THE_BILL_OF_LADING',
      'TOTAL_LOSS_COLLECTS_NOTHING',
      'WEIGHT_TICKETS_WITH_THE_FREIGHT_BILL',
    ])
    for (const row of table.rows.values()) {
      expect(row.primary, `${row.id}: only src:cfr-49-375 is captured`).toBe(
        row.source === 'src:cfr-49-375',
      )
    }
  })

  it('names the publishers, because seven rows reads like more agreement than there is', () => {
    // [A1 §9]: a count in prose is gated or deleted. §3.7's prose says three sources, two of them
    // the same programme, and four of the seven rows DoD — enumerated here so none of those can go
    // stale. The argument this protects is §7's: A-COLLECT is rated **medium**, not higher, because
    // the genuinely independent publisher count is two rather than seven.
    const bySource = [...table.rows.values()].map((row) => row.source).sort()
    expect([...new Set(bySource)]).toEqual([
      'src:cfr-49-375',
      'src:dp3-400ng',
      'src:dp3-tender-of-service',
    ])
    const dp3 = bySource.filter((source) => source.startsWith('src:dp3-'))
    expect(dp3).toHaveLength(4)
    expect(bySource.filter((source) => source === 'src:cfr-49-375')).toHaveLength(3)
  })

  it('refuses a row whose gating fact is about nothing the model has', () => {
    // The negative half, and the one the loader exists for: a rule whose other operand is not an
    // aggregate kind is not a rule this model can hold, and that is the defect the table is meant
    // to make visible rather than absorb.
    const bad = broken(collectionPreconditions)
    ;(bad['rows'] as Record<string, unknown>[])[0]!['gatingFactAbout'] = 'freightBill'
    expect(() => loadCollectionPreconditions(bad)).toThrow(/freightBill/)
  })
})

describe('[A7 §3.3] charge state is refused, and [SD §6.3] is not reopened', () => {
  it('records the refusal as a plain constant, with [A6 §9]s reason in its docstring', () => {
    // Deliberately NOT a typed gate: the claim is false only when a fact class is minted, and a
    // mint already touches `vocabulary.ts`, [SD §4.7.3], the `AS_WRITTEN` table and a
    // canonical-subjects row. Nothing in the type system moves when that happens.
    expect(CHARGE_STATE_IS_NOT_COMPUTABLE).toBe(true)
  })

  it('no record type carries a charge or invoice state under any spelling', () => {
    // The assertion behind the refusal: eleven publishers, no two alike ([A7 §3.3]). Enumerated as
    // an empty list so that minting one fails by name rather than by count.
    const stateish = (RECORD_TYPES as readonly string[]).filter((type) =>
      /invoice|billing|paid|payment|settle/i.test(type),
    )
    expect(stateish).toEqual([])
  })

  it('`charge` is still the one financial fact class, so [SD §6.3] holds unchanged', () => {
    // [A7] measures the offsetting-record door (§3.8) and does not rehang it. If A7 had minted a
    // collection class, this list would have had to grow — so the assertion is also a check that
    // §3.2's refusal was actually carried out.
    expect([...FINANCIAL_FACT_CLASSES]).toEqual(['charge'])
  })
})
