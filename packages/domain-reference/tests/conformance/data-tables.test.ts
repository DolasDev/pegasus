/**
 * Conformance — the data tables, loaded.
 *
 * The three tables in `data/` are the parts of this specification that change on their own cadence,
 * so they are JSON checked against the vocabulary rather than more types. This file is where the
 * check actually runs: it loads the shipped tables, and then breaks a copy of each in the four ways
 * the loader promises to catch.
 *
 * The negative half is the half that matters. A validator nobody has watched reject anything is a
 * validator that might accept everything — [SD §4.7.2e] is the record of exactly that: a binding
 * document specifying a record that could not be published, unnoticed because nothing checked.
 */
import { describe, expect, it } from 'vitest'

import {
  DataDefect,
  admissibleSubjectKinds,
  loadAuthorityTable,
  loadCanonicalSubjects,
  loadDomainTables,
  loadReasonVocabulary,
  owedAuthorityRows,
  ASSERTION_TYPES,
  REASON_CODES,
  REASON_CODE_OTHER,
  REASON_SCOPES,
} from '../../src/index'

import canonicalSubjects from '../../data/canonical-subjects.json'
import authorityTable from '../../data/authority-table.json'
import reasons from '../../data/reasons.json'

/** A mutable deep copy, so a negative case can break one field without breaking the suite. */
function broken(table: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(table)) as Record<string, unknown>
}

function rowsOf(table: Record<string, unknown>): Record<string, unknown>[] {
  return table['rows'] as Record<string, unknown>[]
}

function rowFor(table: Record<string, unknown>, type: string): Record<string, unknown> {
  const row = rowsOf(table).find((candidate) => candidate['type'] === type)
  if (row === undefined) throw new Error(`no row for ${type}`)
  return row
}

describe('[SD §4.7.1] the canonical-subject table', () => {
  it('loads, and declares exactly the published vocabulary', () => {
    const table = loadCanonicalSubjects(canonicalSubjects)
    // [SD §1.3]: "§4.7.1 is the complete declaration." One row per assertion type, no more.
    expect(table.rows.size).toBe(ASSERTION_TYPES.length)
    for (const type of ASSERTION_TYPES) expect(table.rows.has(type)).toBe(true)
    // [SD §4.7] note 2: eleven named families, three of them non-singletons.
    expect(table.families.size).toBe(11)
    expect([...table.families.values()].filter((family) => !family.singleton)).toHaveLength(3)
  })

  it('carries the families a type may be asserted about — E-CANON, from the table', () => {
    const table = loadCanonicalSubjects(canonicalSubjects)
    // [SD §8.2]: the non-singleton that lets an arrival name a leg nobody can see.
    expect(admissibleSubjectKinds(table, 'arrival')).toEqual(['stop', 'externallyPerformedLeg'])
    // [SD §3.3]: the [ORIGINAL] `goods` family, which lets a separately-timed act name a Portion.
    expect(admissibleSubjectKinds(table, 'delivery')).toEqual(['shipment', 'portion'])
    // [SD §7.1]: "subject may be ANY aggregate kind".
    expect(admissibleSubjectKinds(table, 'identity')).toHaveLength(14)
  })

  it('says how much of the authority column is owed, rather than implying it is filled in', () => {
    const table = loadCanonicalSubjects(canonicalSubjects)
    const owed = owedAuthorityRows(table)
    // The count is the disclosure. [A8 §9 item 8] plus [SD §4.7.3]'s two provisional rows leave
    // most of the lifecycle side undecided, and a reader who is not told assumes otherwise.
    //
    // Nineteen, not eighteen: [SD §4.7.2f] §7.4 moved `handover` from **assigned** to **owed**,
    // because its `boundBy = CUSTODY` was circular — [SD §4.8.2] refuses that exact shape, "so
    // A8-MOVE would be defined in terms of the thing it defines". An owed row here is not a
    // regression; it is a contradiction stopping being hidden behind a filled-in cell. F3.
    expect(owed.length).toBe(19)
    expect(owed.map((row) => row.type)).toContain('handover')
    expect(owed.every((row) => row.authority.scoring === 'do-not-score')).toBe(true)
    for (const row of owed) {
      if (row.authority.status === 'owed') expect(row.authority.owedTo.length).toBeGreaterThan(0)
    }
  })

  it('refuses an unknown record type', () => {
    const table = broken(canonicalSubjects)
    // `weighing` is named in the corpus and is deliberately NOT in the vocabulary ([SD §4.7.3]).
    rowFor(table, 'delivery')['type'] = 'weighing'
    expect(() => loadCanonicalSubjects(table)).toThrow(DataDefect)
  })

  it('refuses a row for a meta-record type, and says why', () => {
    const table = broken(canonicalSubjects)
    rowFor(table, 'delivery')['type'] = 'FactResolved'
    // [SD §1.3] item 4 fixes a meta-record's subject rule; [SD §4.7.1] declares no row for one.
    expect(() => loadCanonicalSubjects(table)).toThrow(/meta-record/)
  })

  it('refuses a missing family, and a family that disagrees with the types', () => {
    const missing = broken(canonicalSubjects)
    delete rowFor(missing, 'delivery')['family']
    expect(() => loadCanonicalSubjects(missing)).toThrow(DataDefect)

    const wrong = broken(canonicalSubjects)
    // delivery's family is `goods`; `stop` is the family the shipped scenario gets wrong.
    rowFor(wrong, 'delivery')['family'] = 'stop'
    expect(() => loadCanonicalSubjects(wrong)).toThrow(/CANONICAL_SUBJECT_FAMILY/)
  })

  it('refuses a family member that is not an aggregate kind', () => {
    const table = broken(canonicalSubjects)
    const families = table['families'] as Record<string, Record<string, Record<string, unknown>>>
    const goods = families['members']?.['goods']
    // `custody` is the case the documents care about: [SD §4.7.3] / [SD §4.8] say there is no such
    // aggregate and there will not be one.
    ;(goods?.['members'] as string[]).push('custody')
    expect(() => loadCanonicalSubjects(table)).toThrow(/aggregate enum/)
  })

  it('refuses an authority value that is neither a role nor owed', () => {
    const table = broken(canonicalSubjects)
    const authority = rowFor(table, 'packing')['authority'] as Record<string, unknown>
    const provisional = authority['provisional'] as Record<string, unknown>
    // A designation the role enum does not contain belongs in `unresolved` with what it is owed
    // to ([A8 §9 item 2]) — never in a roles list.
    ;(provisional['roles'] as string[]).push('the warehouseman')
    expect(() => loadCanonicalSubjects(table)).toThrow(/is not a role/)
  })

  it('refuses an owed authority that claims to be scoreable', () => {
    const table = broken(canonicalSubjects)
    const authority = rowFor(table, 'tripDelay')['authority'] as Record<string, unknown>
    authority['scoring'] = 'capped-medium'
    // [SD §4.7] note 3: a provisional reading "may not be used to score a dependent decision".
    expect(() => loadCanonicalSubjects(table)).toThrow(/never be scored/)
  })

  it('refuses a qualifier on a type that declares none, and a missing one on a type that does', () => {
    const stray = broken(canonicalSubjects)
    rowFor(stray, 'delivery')['qualifier'] = {
      fields: ['aspect'],
      values: null,
      marker: null,
      citation: 'x',
    }
    // [SD §1.3] item 3: a stray qualifier splits one contest into several.
    expect(() => loadCanonicalSubjects(stray)).toThrow(/declares no qualifier/)

    const absent = broken(canonicalSubjects)
    rowFor(absent, 'pieceCount')['qualifier'] = null
    expect(() => loadCanonicalSubjects(absent)).toThrow(/declares a qualifier/)
  })

  it('refuses an incomplete table', () => {
    const table = broken(canonicalSubjects)
    table['rows'] = rowsOf(table).filter((row) => row['type'] !== 'orderAward')
    // The [SD §4.7.2e] defect, caught: a record the binding layer requires and no row declares.
    expect(() => loadCanonicalSubjects(table)).toThrow(/COMPLETE declaration/)
  })
})

describe('[A8 §5] the authority table', () => {
  it('loads eleven rows and does not pretend to cover more', () => {
    const table = loadAuthorityTable(authorityTable)
    expect(table.rows.size).toBe(11)
    // [A8 §9 item 8]: everything else is uncovered, so there is deliberately no completeness check.
    expect(table.byType.has('tripDelay')).toBe(false)
  })

  it('carries the three rows with no single authoritative role, each with a named rule', () => {
    const table = loadAuthorityTable(authorityTable)
    const unsettled = [...table.rows.values()].filter(
      (row) =>
        row.standings.kind === 'uniform' &&
        (row.standings.authoritative.cardinality === 'empty' ||
          row.standings.authoritative.cardinality === 'joint'),
    )
    // [A8 §5]'s own closing observation: three of eleven, and each supplies something better than
    // a role — a value rule, a mandatory derivation, or a joint record.
    expect(unsettled.map((row) => row.type).sort()).toEqual([
      'condition',
      'sitEntryDate',
      'weight.net',
    ])
    // [A8 §4.4] A8-NAMED: "a resolution may never fall back to 'latest wins' implicitly."
    expect(unsettled.map((row) => row.settlement?.ruleId)).toEqual(
      expect.arrayContaining(['R-WEIGHT-LOWER', 'M4', 'A8-JOINT']),
    )
  })

  it('keeps authority over the SIT entry INPUT separate from the derived date', () => {
    const table = loadAuthorityTable(authorityTable)
    const row = table.byType.get('sitEntryDate')
    // [A8 §5 r7]: nobody is authoritative for the date; the hauler/destinationAgent is
    // authoritative for the first available delivery date the derivation reads.
    expect(row?.inputAuthority?.roles).toEqual(['hauler', 'destinationAgent'])
    expect(row?.boundBy).toBe('NONE')
  })

  it('refuses a row whose subject family disagrees with [SD §4.7]', () => {
    const table = broken(authorityTable)
    rowFor(table, 'delivery')['family'] = 'stop'
    // [A8 §5] caveat (i): the column is quoted, "nothing in this column is assumed".
    expect(() => loadAuthorityTable(table)).toThrow(/quotes stop where/)
  })

  it('refuses an empty authoritative standing with no named rule — A8-NAMED', () => {
    const table = broken(authorityTable)
    rowFor(table, 'weight.net')['settlement'] = null
    expect(() => loadAuthorityTable(table)).toThrow(/A8-NAMED/)
  })

  it('refuses a cardinality that does not match the holders it lists', () => {
    const table = broken(authorityTable)
    const standings = rowFor(table, 'loading')['standings'] as Record<
      string,
      Record<string, unknown>
    >
    const authoritative = standings['authoritative']
    if (authoritative !== undefined) authoritative['cardinality'] = 'one'
    // Two roles listed and 'one' claimed: the row would look settled and be an alternative pair.
    expect(() => loadAuthorityTable(table)).toThrow(/says one for 2 holder/)
  })

  it('refuses an unresolved asserter that does not say what it is owed to', () => {
    const table = broken(authorityTable)
    const standings = rowFor(table, 'delivery')['standings'] as Record<
      string,
      Record<string, unknown>
    >
    const unresolved = standings['authoritative']?.['unresolved'] as Record<string, unknown>[]
    const first = unresolved[0]
    if (first !== undefined) delete first['owedTo']
    expect(() => loadAuthorityTable(table)).toThrow(DataDefect)
  })
})

describe('[SD §2.4], [A4 §3] the reason vocabulary', () => {
  it('ships the shape AND the list, because A4 has been written', () => {
    const vocabulary = loadReasonVocabulary(reasons)
    expect(vocabulary.status).toBe('published')
    expect(vocabulary.owedTo).toBeNull()
    // [A4 §3]. [SD §2.4] rule 2's magnitude — "~20 reasons x 5 outcomes, not ~100 types" — and the
    // table is the enum, which the set check below is what actually enforces.
    expect(vocabulary.codes).toHaveLength(REASON_CODES.length)
    expect(vocabulary.codes.map((entry) => entry.code).sort()).toEqual([...REASON_CODES].sort())
    // The shape is unchanged: six fields, six rules, six scopes.
    expect(vocabulary.shapeFields).toHaveLength(6)
    expect(vocabulary.rules).toHaveLength(6)
    expect(vocabulary.scopes).toHaveLength(6)
    expect(vocabulary.openMemberCode).toBe(REASON_CODE_OTHER)
  })

  it('declares an attribution discipline and a remedy obligation for every member', () => {
    const vocabulary = loadReasonVocabulary(reasons)
    // `whenA4Lands` stated the contract for landing: "each member needs a code, a default scope, its
    // attribution discipline, and whether it requires a remedy."
    for (const entry of vocabulary.codes) {
      expect(REASON_SCOPES).toContain(entry.scope)
      expect(typeof entry.partyRequired).toBe('boolean')
      expect(entry.citation).not.toBe('')
    }
    // [A4 §3]: `partyRequired` is true for every PARTY-scope member and no other, because a
    // party-side reason that cannot name the party is the `DIV` overload invariant 2 removes.
    const requiresParty = vocabulary.codes.filter((entry) => entry.partyRequired)
    expect(requiresParty.every((entry) => entry.scope === 'PARTY')).toBe(true)
    expect(vocabulary.codes.filter((entry) => entry.scope === 'PARTY')).toHaveLength(
      requiresParty.length,
    )
    // [SD §2.4] rule 5's two codes, and the one shape a source states.
    expect(
      vocabulary.codes
        .filter((entry) => entry.remedyRequired)
        .map((entry) => entry.code)
        .sort(),
    ).toEqual(['PARTY_ABSENT', 'PARTY_RESCHEDULED'])
    for (const entry of vocabulary.codes) {
      if (entry.remedyRequired) expect(entry.remedyShape).toBe('newWindow')
    }
  })

  it('discloses every authored member at the point of use', () => {
    const vocabulary = loadReasonVocabulary(reasons)
    // [SD §0]. Three members carry a marker and the rest are sourced outright; the markers are
    // published in the table so a consumer reading `index.json` sees them without reading [A4].
    const marked = new Map(
      vocabulary.codes
        .filter((entry) => entry.marker !== null)
        .map((entry) => [entry.code, entry.marker]),
    )
    expect(marked.get('GOODS_MISSING')).toBe('[SYNTHESIS]')
    expect(marked.get('SITE_HANDLING_EXCESS')).toBe('[SYNTHESIS]')
    expect(marked.get('OUT_OF_SEQUENCE')).toBe('[ORIGINAL]')
    // The shuttle reason is NOT authored: `src:dp3-400ng` Item 125.1 enumerates its causes and
    // Item 33 adds impractical operations ([A4 §4.4]).
    expect(marked.has('SITE_INACCESSIBLE')).toBe(false)
  })

  it('records the two-axis factorisation as five outcomes, reasons reused across them', () => {
    const vocabulary = loadReasonVocabulary(reasons)
    expect(vocabulary.outcomes).toHaveLength(5)
    // [SD §2.2]: "completed with exception" is a FIRST-CLASS outcome — Shippeo's LIV/RCA is the
    // only published model of it, and the table must say what makes it one.
    const exception = vocabulary.outcomes.find((o) => o.outcome === 'COMPLETED_WITH_EXCEPTION')
    expect(exception?.firstClassNote).toMatch(/FIRST-CLASS/)
    expect(exception?.reasonsRequired).toBe(true)
    // [SD §2.3] invariant 2: reasons are forbidden at COMPLETED and required everywhere else.
    expect(vocabulary.outcomes.filter((o) => o.reasonsForbidden)).toHaveLength(1)
    // [SD §2.4] rule 1: a reason is not welded to an outcome, so the record carries no such field.
    expect(vocabulary.forbiddenFields).toContain('outcome')
  })

  it("keeps [SD §2.6]'s worked literals out of the vocabulary, and none of them is a member", () => {
    const vocabulary = loadReasonVocabulary(reasons)
    // "Three examples are not a vocabulary." They are kept so the scenario reads, in a field the
    // loader refuses to merge with `codes` — and [A4 §4] found that all three had to be renamed
    // anyway: `CONSIGNEE_ABSENT` bakes a role into the code ([SD §2.4] rule 6), `REFUSED_DAMAGE`
    // encodes an outcome in a verb (rule 1), and `SHORT` is `GOODS_MISSING` under another name.
    expect(vocabulary.illustrativeOnly.map((entry) => entry.code)).toEqual([
      'CONSIGNEE_ABSENT',
      'REFUSED_DAMAGE',
      'SHORT',
    ])
    for (const entry of vocabulary.illustrativeOnly) {
      expect(REASON_CODES).not.toContain(entry.code)
    }
  })

  it('refuses an owed vocabulary that has quietly acquired codes', () => {
    const table = broken(reasons)
    const vocabulary = table['vocabulary'] as Record<string, unknown>
    vocabulary['status'] = 'owed'
    // [SD §0]: a guessed value that makes the table look finished is the defect, not the fix. The
    // check is kept live after A4 because the next owed vocabulary — `roleClass`, `unitOfMeasure` —
    // is loaded by the same reader.
    expect(() => loadReasonVocabulary(table)).toThrow(/owed vocabulary carries no codes/)
  })

  it('refuses a published vocabulary that drifts from REASON_CODES, in either direction', () => {
    // The tamper proof for the set check. It is the one gate A4 adds, and a gate that has not been
    // watched to fail is a gate nobody knows is live.
    const missing = broken(reasons)
    const missingCodes = (missing['vocabulary'] as Record<string, unknown>)['codes'] as unknown[]
    missingCodes.pop()
    expect(() => loadReasonVocabulary(missing)).toThrow(/exactly the 23 members of REASON_CODES/)

    const extra = broken(reasons)
    ;((extra['vocabulary'] as Record<string, unknown>)['codes'] as unknown[]).push({
      code: 'GOODS_MISLAID',
      scope: 'GOODS',
      partyRequired: false,
      remedyRequired: false,
      remedyShape: null,
      marker: null,
      citation: 'invented',
    })
    expect(() => loadReasonVocabulary(extra)).toThrow(/exactly the 23 members of REASON_CODES/)
  })

  it('refuses a code that must carry a remedy and names no shape', () => {
    const table = broken(reasons)
    const codes = (table['vocabulary'] as Record<string, unknown>)['codes'] as Record<
      string,
      unknown
    >[]
    const absent = codes.find((entry) => entry['code'] === 'PARTY_ABSENT')
    if (absent !== undefined) absent['remedyShape'] = null
    // [SD §2.4] rule 5: "a failed delivery that does not say when it will be retried is an
    // incomplete record", so a code that requires a remedy and names no shape is that record.
    expect(() => loadReasonVocabulary(table)).toThrow(/must name the shape it requires/)
  })

  it('refuses a reason code that names an outcome', () => {
    const table = broken(reasons)
    const vocabulary = table['vocabulary'] as Record<string, unknown>
    vocabulary['status'] = 'published'
    ;(vocabulary['codes'] as unknown[]).push({
      code: 'CANCELLED_BY_SHIPPER',
      scope: 'PARTY',
      partyRequired: true,
      remedyRequired: false,
      remedyShape: null,
      marker: null,
      citation: 'invented',
    })
    // The mirror of A-TYPE ([SD §2.5]) one axis over. Partial by construction — it cannot catch
    // rule 1's own DELIVERED_SHORT, which hides the outcome in a verb.
    expect(() => loadReasonVocabulary(table)).toThrow(/names the outcome CANCELLED/)
  })

  it('refuses an outcome row that disagrees with the invariant in the types', () => {
    const table = broken(reasons)
    const outcomes = table['outcomes'] as Record<string, unknown>[]
    const completed = outcomes.find((entry) => entry['outcome'] === 'COMPLETED')
    if (completed !== undefined) completed['reasonsRequired'] = true
    expect(() => loadReasonVocabulary(table)).toThrow(/reasonsAreRequired/)
  })

  it('refuses an open member with an optional narrative', () => {
    const table = broken(reasons)
    const openMember = table['openMember'] as Record<string, unknown>
    openMember['remarkRequired'] = false
    // [SD §2.4] rule 3, sourced twice — OTM 5.7 and src:dp3-400ng Item 226A.
    expect(() => loadReasonVocabulary(table)).toThrow(/requires a narrative/)
  })
})

describe('the three tables together', () => {
  it('load and agree', () => {
    const tables = loadDomainTables({ canonicalSubjects, authority: authorityTable, reasons })
    expect(tables.canonicalSubjects.rows.size).toBe(ASSERTION_TYPES.length)
    expect(tables.authority.rows.size).toBe(11)
    expect(tables.reasons.status).toBe('published')
  })

  it('refuses a cross-type A8 link that claims to be same-type', () => {
    const table = broken(canonicalSubjects)
    const authority = rowFor(table, 'pieceCount')['authority'] as Record<string, unknown>
    const link = authority['a8Row'] as Record<string, unknown>
    link['sameType'] = true
    // The link is to row 9, which is `condition`: legitimate, but only because A8-JOINT reaches
    // "condition AND the counts asserted with it". A link that hides the jump makes an uncovered
    // fact class look covered.
    expect(() =>
      loadDomainTables({ canonicalSubjects: table, authority: authorityTable, reasons }),
    ).toThrow(/claims sameType/)
  })

  it('refuses an authority split that does not match the declared qualifier values', () => {
    const table = broken(authorityTable)
    const standings = rowFor(table, 'charge')['standings'] as Record<
      string,
      Record<string, unknown>
    >
    const byValue = standings['authoritativeByValue'] as Record<string, unknown>
    delete byValue['RATED']
    // [SD §4.7.2b]: {aspect} makes propose / decide / rate THREE FACT KEYS. A split that misses
    // one leaves a fact key with no authority at all.
    expect(() => loadDomainTables({ canonicalSubjects, authority: table, reasons })).toThrow(
      /splits on/,
    )
  })

  it('refuses an [A8 §5] row for a type the vocabulary does not declare', () => {
    const table = broken(authorityTable)
    rowFor(table, 'condition')['type'] = 'Correction'
    expect(() => loadDomainTables({ canonicalSubjects, authority: table, reasons })).toThrow(
      DataDefect,
    )
  })
})
