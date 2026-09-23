/**
 * Conformance — the vocabulary is closed, complete, and says the same thing twice.
 *
 * [SD §1.3] makes [SD §4.7.1] the **complete** declaration of the published record vocabulary. That
 * claim is only true if four things hold at once, and each of them is a separate way for the
 * specification to rot:
 *
 * 1. every `type` declares a canonical subject family, and every family member is a member of
 *    [SD §1.2]'s closed aggregate enum;
 * 2. nothing is a `type` that [SD §4.7.1] did not declare one — not a family name, not a prose
 *    alias, not a fact class [SD §4.7.3] records as absent;
 * 3. every authority cell is a **role** or an explicit **owed** marker, never prose sitting where a
 *    role belongs ([SD §4.7] note 3, [A8 §9 item 2]);
 * 4. the JSON tables in `data/` and the types in `src/` agree **in both directions**.
 *
 * The fourth is the one that has no other guard. `data.ts`'s loaders check every row they are given
 * against the types, so a bad row cannot load — but a table that is merely *smaller* than the
 * vocabulary, or a type-level table that has quietly grown a member the JSON never heard of, is the
 * [SD §4.7.2e] defect exactly: "a binding document… specifying a record that could not be
 * published", unnoticed because nothing counted both sides.
 */
import { describe, expect, it } from 'vitest'

import {
  ABSENT_AND_OWED,
  ACT_TYPES,
  AGGREGATE_KINDS,
  ASSERTION_TYPES,
  CANONICAL_SUBJECT_FAMILY,
  FACT_CLASS_FAMILIES,
  FACT_CLASS_FAMILY,
  META_RECORD_TYPES,
  NON_ACT_TYPES,
  OUTCOMES,
  PROSE_ALIASES,
  QUALIFIER_FIELDS,
  QUALIFIER_TYPES,
  RECORD_TYPES,
  ROLE_NAMES,
  SUBJECT_FAMILIES,
  admitSubject,
  isActType,
  isAggregateKind,
  isAssertionType,
  isSingletonFamily,
  loadDomainTables,
  owedAuthorityRows,
  subjectRef,
  aggregateId,
  type AggregateKind,
  type AssertionType,
  type AuthorityRow,
  type CanonicalSubjectRow,
  type RoleName,
  type SubjectFamilyName,
} from '../../src/index'

import canonicalSubjects from '../../data/canonical-subjects.json'
import authorityTable from '../../data/authority-table.json'
import reasons from '../../data/reasons.json'

const tables = loadDomainTables({ canonicalSubjects, authority: authorityTable, reasons })

const FAMILY_NAMES = Object.keys(SUBJECT_FAMILIES) as readonly SubjectFamilyName[]

/** Set difference, reported as a sorted list so a failure names the offending members. */
function missing<T extends string>(expected: readonly T[], actual: readonly string[]): string[] {
  const have = new Set(actual)
  return expected.filter((member) => !have.has(member)).sort()
}

describe('[SD §4.7.1] every record type has a canonical subject family', () => {
  it('declares one family per assertion type, and every family is a declared one', () => {
    for (const type of ASSERTION_TYPES) {
      const family = CANONICAL_SUBJECT_FAMILY[type]
      expect(family, `${type} declares no canonical subject family`).toBeDefined()
      expect(FAMILY_NAMES, `${type} declares the undeclared family ${family}`).toContain(family)
    }
    // The count is part of the claim: a type with no row is unpublishable under E-CANON-STRICT,
    // and a row with no type is a declaration nobody can use ([SD §4.7.2e]).
    expect(Object.keys(CANONICAL_SUBJECT_FAMILY).sort()).toEqual([...ASSERTION_TYPES].sort())
  })

  it('declares none for the two meta-record types, by design', () => {
    // [SD §1.3] item 4: a meta-record's `type` names the record CLASS, and its subject rule is
    // fixed elsewhere — "the envelope `subject` MUST equal the subject of the fact being resolved
    // or corrected". A [SD §4.7.1] row for one would be a declaration [SD §4.7] never made.
    const declared = CANONICAL_SUBJECT_FAMILY as Readonly<Record<string, SubjectFamilyName>>
    for (const type of META_RECORD_TYPES) {
      expect(declared[type], `${type} has acquired a [SD §4.7.1] row`).toBeUndefined()
    }
  })

  it('admits exactly the family it declares, and refuses everything else — E-CANON-STRICT', () => {
    // [SD §4.6.2]: "The admission check is purely structural… The boundary performs no
    // substitution, no nearest-match and no best-guess." Run over the whole cross-product, so the
    // claim is tested for all 31 × 14 pairs rather than for the two the documents work through.
    for (const type of ASSERTION_TYPES) {
      const members: readonly AggregateKind[] = SUBJECT_FAMILIES[CANONICAL_SUBJECT_FAMILY[type]]
      for (const kind of AGGREGATE_KINDS) {
        const verdict = admitSubject(type, subjectRef(kind, aggregateId(kind, 'x')))
        expect(verdict.admitted, `${type} about ${kind}`).toBe(members.includes(kind))
      }
    }
  })
})

describe('[SD §1.2] every family member is a declared aggregate kind', () => {
  it('holds for all eleven families, with no duplicate and no empty one', () => {
    for (const name of FAMILY_NAMES) {
      const members: readonly AggregateKind[] = SUBJECT_FAMILIES[name]
      // [SD §4.7] note 2: "a family is a named, closed SET of `aggregate` kinds". Empty is not a
      // set anything can be asserted about, and a repeat makes `isSingletonFamily` lie.
      expect(members.length, `family ${name} is empty`).toBeGreaterThan(0)
      expect(new Set(members).size, `family ${name} repeats a member`).toBe(members.length)
      for (const member of members) {
        expect(isAggregateKind(member), `${name} admits ${member}`).toBe(true)
      }
      expect(isSingletonFamily(name)).toBe(members.length === 1)
    }
  })

  it('has exactly three non-singletons, and each is the one its document argues for', () => {
    const plural = FAMILY_NAMES.filter((name) => !isSingletonFamily(name))
    // A fourth would be a decision, not a detail — [SD §4.7] note 2 argues each of the three where
    // it is declared, and a family that quietly widened would widen E-CANON with it.
    expect(plural.sort()).toEqual(['anyAggregate', 'goods', 'stop'])
    expect(SUBJECT_FAMILIES.stop).toEqual(['stop', 'externallyPerformedLeg']) // [SD §8.2]
    expect(SUBJECT_FAMILIES.goods).toEqual(['shipment', 'portion']) // [SD §3.3] — **[ORIGINAL]**
    // [SD §7.1] `identity`'s family is "the whole `aggregate` enum", so it tracks the enum itself.
    expect(SUBJECT_FAMILIES.anyAggregate).toEqual(AGGREGATE_KINDS)
  })
})

describe('[SD §4.7.1] no type exists outside the declaration', () => {
  it('is the union of the acts and the non-acts, disjointly, plus the two meta-records', () => {
    expect([...RECORD_TYPES].sort()).toEqual([...ASSERTION_TYPES, ...META_RECORD_TYPES].sort())
    expect(new Set(RECORD_TYPES).size).toBe(RECORD_TYPES.length)
    // [SD §4.1]'s act/non-act cut decides `value`'s shape and M2/M3/M5's reach. A member on both
    // sides would make `isActType` and `ValueOf` disagree about the same record.
    const acts = new Set<string>(ACT_TYPES)
    expect(NON_ACT_TYPES.filter((type) => acts.has(type))).toEqual([])
    for (const type of ASSERTION_TYPES) expect(isAssertionType(type)).toBe(true)
    for (const type of ACT_TYPES) expect(isActType(type)).toBe(true)
    for (const type of NON_ACT_TYPES) expect(isActType(type)).toBe(false)
  })

  it('refuses the four kinds of near-member the documents name', () => {
    const vocabulary = new Set<string>(RECORD_TYPES)

    // (a) [SD §4.7.1]: "**A record may never carry `type = actPerformance`**" — a family name is
    // not a member. The three family names that DO coincide with a type do so because the family
    // has exactly one member and the two names denote the same thing.
    for (const family of FACT_CLASS_FAMILIES) {
      const coincides = family === 'condition' || family === 'identity' || family === 'partyRole'
      expect(vocabulary.has(family), `fact-class family ${family}`).toBe(coincides)
    }

    // (b) [SD §4.7.3] / [SD §4.8]: "`custody`… There is no such `type` and there will not be one."
    expect(vocabulary.has('custody')).toBe(false)
    expect(isAggregateKind('custody')).toBe(false)

    // (c) [SD §4.7.3]: the classes recorded as absent "so their absence is not read as an
    // oversight". An absent class that quietly acquired a row would erase its own disclosure.
    for (const absent of ABSENT_AND_OWED) {
      expect(vocabulary.has(absent), `${absent} is recorded absent and has a type`).toBe(false)
    }

    // (d) [SD §4.7] note 5: "The spellings in the first column are the vocabulary; the rest are
    // prose aliases" — and a prose alias "must not appear in a record".
    for (const [alias, target] of Object.entries(PROSE_ALIASES)) {
      expect(vocabulary.has(alias), `prose alias ${alias} is a type`).toBe(false)
      expect(vocabulary.has(target), `${alias} aliases the non-member ${target}`).toBe(true)
    }
  })

  it('carries **Rule A-TYPE** at runtime as well as in the types', () => {
    // [SD §2.5]: "It MUST NOT encode the outcome. `Delivery.Completed` is not a legal type name."
    // `OutcomeFreeTypeName` holds this at compile time over the union; this is the same check over
    // the runtime list, so a member added to one list and not the other cannot slip past both.
    for (const type of RECORD_TYPES) {
      for (const outcome of OUTCOMES) {
        expect(
          type.toLowerCase().includes(outcome.toLowerCase()),
          `${type} encodes the outcome ${outcome}`,
        ).toBe(false)
      }
    }
  })

  it('joins every type to a fact-class family, or marks the join owed', () => {
    // [SYNTHESIS] of [SD §4.1]'s families and [SD §4.7.1]'s types. The two rows the join cannot
    // make are marked `owed` rather than guessed, and that marking is itself the assertion here:
    // `charge` is a money fact [SD §4.1] never listed, `notification` is provisional throughout.
    const owedJoins = ASSERTION_TYPES.filter((type) => FACT_CLASS_FAMILY[type] === 'owed')
    expect(owedJoins.sort()).toEqual(['charge', 'notification'])
    for (const type of ASSERTION_TYPES) {
      const family = FACT_CLASS_FAMILY[type]
      if (family === 'owed') continue
      expect(FACT_CLASS_FAMILIES, `${type} joins the undeclared family ${family}`).toContain(family)
      expect(family === 'actPerformance').toBe(isActType(type))
    }
    // [SD §4.1] declares a `state` family and [SD §4.7.1] declares no member for it. Reported, not
    // papered over: a declared family with nothing publishable in it is a finding the module's own
    // header records, and this is where it stays visible.
    const populated = new Set<string>(ASSERTION_TYPES.map((type) => FACT_CLASS_FAMILY[type]))
    expect(populated.has('state')).toBe(false)
    expect(FACT_CLASS_FAMILIES, 'the family itself is still declared').toContain('state')
  })
})

/* ─────────────────  authority cells: a role, or the owed marker  ───────────────── */

const roleNames = new Set<string>(ROLE_NAMES)

/** Every role-position value on one [SD §4.7.1] row, with where it came from. */
function authorityRoles(row: CanonicalSubjectRow): { at: string; role: RoleName }[] {
  if (row.authority.status !== 'owed' || row.authority.provisional === null) return []
  return row.authority.provisional.roles.map((role) => ({
    at: `canonical-subjects[${row.type}].authority.provisional.roles`,
    role,
  }))
}

/** Every role-position value on one [A8 §5] row, with where it came from. */
function tableRoles(row: AuthorityRow): { at: string; role: RoleName }[] {
  const found: { at: string; role: RoleName }[] = []
  const take = (at: string, roles: readonly RoleName[]): void => {
    for (const role of roles) found.push({ at: `authority-table[row ${row.row}].${at}`, role })
  }
  const { standings } = row
  if (standings.kind === 'uniform') {
    take('standings.authoritative', standings.authoritative.roles)
  } else {
    for (const [value, standing] of standings.authoritativeByValue) {
      take(`standings.authoritativeByValue.${value}`, standing.roles)
    }
  }
  take('standings.corroborating', standings.corroborating.roles)
  take('standings.competing', standings.competing.roles)
  take('standings.advisory', standings.advisory.roles)
  if (row.inputAuthority !== null) take('inputAuthority', row.inputAuthority.roles)
  return found
}

describe('[SD §4.7] note 3 every authority cell is a role or the explicit owed marker', () => {
  it('puts nothing but [A8 §2] roles in a role position', () => {
    const cells = [
      ...[...tables.canonicalSubjects.rows.values()].flatMap(authorityRoles),
      ...[...tables.authority.rows.values()].flatMap(tableRoles),
    ]
    // The split is the whole point ([A8 §9 item 2]): a designation the role enum does not contain
    // — "the tariff owner", "the leg's authoritativeAsserter" — belongs in `unresolved` naming what
    // it is owed to, so the gap stays countable instead of reading as a filled-in answer.
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(roleNames.has(cell.role), `${cell.at} holds the non-role ${cell.role}`).toBe(true)
    }
  })

  it('makes every non-role designation name what it is owed to', () => {
    const unresolved: { at: string; designation: string; owedTo: string }[] = []
    for (const row of tables.authority.rows.values()) {
      const { standings } = row
      const bags = [
        ['corroborating', standings.corroborating.unresolved],
        ['competing', standings.competing.unresolved],
        ['advisory', standings.advisory.unresolved],
        ...(standings.kind === 'uniform'
          ? ([['authoritative', standings.authoritative.unresolved]] as const)
          : [...standings.authoritativeByValue].map(
              ([value, standing]) => [`authoritative.${value}`, standing.unresolved] as const,
            )),
        ...(row.inputAuthority === null
          ? []
          : ([['inputAuthority', row.inputAuthority.unresolved]] as const)),
      ] as const
      for (const [at, bag] of bags) {
        for (const entry of bag) {
          unresolved.push({ at: `authority-table[row ${row.row}].${at}`, ...entry })
        }
      }
    }
    expect(unresolved.length).toBeGreaterThan(0)
    for (const entry of unresolved) {
      expect(entry.designation.length, `${entry.at} has an empty designation`).toBeGreaterThan(0)
      expect(
        entry.owedTo.length,
        `${entry.at}: "${entry.designation}" is owed to nobody`,
      ).toBeGreaterThan(0)
    }
  })

  it('marks an owed authority owed, names the owner, and bars it from scoring', () => {
    const owed = owedAuthorityRows(tables.canonicalSubjects)
    // [SD §4.7] note 3: a provisional reading "may not be used to score a dependent decision above
    // medium". The count is the disclosure — [A8 §9 item 8] leaves most of the lifecycle side
    // undecided, and a reader who is not told how much assumes it is not much.
    //
    // Fourteen. `handover` was one of the nineteen — its `boundBy` was owed and EXPRESSLY NOT
    // `CUSTODY`, because a `CUSTODY` binding on the row the fold folds over is the circularity
    // [SD §4.8.2] refuses. **F3 closed it** at [A8 §5] row 12 with `boundBy = KEY`, which reads the
    // fact's own qualifier instead of the fold.
    expect(owed.length).toBe(14)
    expect(owed.map((row) => row.type)).not.toContain('handover')
    expect(owed.map((row) => row.type)).toContain('tripDelay')
    for (const row of owed) {
      expect(row.authority.scoring, `${row.type} is owed and scoreable`).toBe('do-not-score')
      // `conditional` is [SD §4.7.1]'s `pieceCount` row — assigned in one named scope and owed
      // outside it. Both arms name an owner, which is what makes the gap countable either way.
      const owner = row.authority.status === 'assigned' ? null : row.authority.owedTo
      expect(owner?.length ?? 0, `${row.type} is owed to nobody`).toBeGreaterThan(0)
      expect(row.authority.citations.length).toBeGreaterThan(0)
    }
    // And the complement: every row that is NOT owed says what settles it.
    for (const row of tables.canonicalSubjects.rows.values()) {
      if (row.authority.status !== 'assigned') continue
      expect(
        row.authority.summary.length,
        `${row.type} is assigned and says nothing`,
      ).toBeGreaterThan(0)
    }
  })
})

/* ────────────────  the tables and the types, in both directions  ──────────────── */

describe('the data tables and the types agree in both directions', () => {
  it('declares each family once, with the same members on both sides', () => {
    expect([...tables.canonicalSubjects.families.keys()].sort()).toEqual([...FAMILY_NAMES].sort())
    expect(missing(FAMILY_NAMES, [...tables.canonicalSubjects.families.keys()])).toEqual([])
    for (const [name, declaration] of tables.canonicalSubjects.families) {
      // Two spellings of one closed set that can drift are not one closed set.
      expect([...declaration.members].sort(), `family ${name}`).toEqual(
        [...SUBJECT_FAMILIES[name]].sort(),
      )
      expect(declaration.citation.length, `family ${name} cites nothing`).toBeGreaterThan(0)
    }
  })

  it('declares each vocabulary member once, and nothing that is not one', () => {
    const rows = [...tables.canonicalSubjects.rows.keys()]
    // Forwards: [SD §1.3]'s "complete declaration" claim.
    expect(missing(ASSERTION_TYPES, rows), 'vocabulary members with no [SD §4.7.1] row').toEqual([])
    // Backwards: the direction `data.ts` cannot check on its own, because a row for a non-member
    // would have been refused at read time — but a row that is legal AND surplus would not.
    expect(
      missing(rows as readonly AssertionType[], ASSERTION_TYPES),
      'rows for non-members',
    ).toEqual([])
    for (const [type, row] of tables.canonicalSubjects.rows) {
      expect(row.family, `${type}'s family`).toBe(CANONICAL_SUBJECT_FAMILY[type])
      expect(row.citations.length, `${type} cites nothing`).toBeGreaterThan(0)
      // [SD §1.4]: `context[]` is advisory, so the table may list kinds freely — but every one of
      // them still has to be a kind.
      for (const kind of row.context) expect(isAggregateKind(kind)).toBe(true)
    }
  })

  it('declares a qualifier on exactly the four types that have one', () => {
    const withQualifier = [...tables.canonicalSubjects.rows.values()]
      .filter((row) => row.qualifier !== null)
      .map((row) => row.type)
    // [SD §1.3] item 3: "a type that declares none has none, and its fact key is `(subject, type)`."
    // A stray qualifier silently splits one contest into several; a missing one silently merges
    // three into one, which is the defect [SD §4.7.2b] corrects in [A8 §5 row 11] — and, on
    // `handover`, the defect [SD §4.7.2f] corrects as **F1**, where a missing qualifier merged
    // every handover about one shipment into a single contest with a single survivor.
    expect(withQualifier.sort()).toEqual([...QUALIFIER_TYPES].sort())
    for (const type of QUALIFIER_TYPES) {
      const row = tables.canonicalSubjects.rows.get(type)
      expect([...(row?.qualifier?.fields ?? [])].sort()).toEqual([...QUALIFIER_FIELDS[type]].sort())
    }
  })

  it("quotes [SD §4.7]'s subject column into [A8 §5] without re-deriving it", () => {
    for (const row of tables.authority.rows.values()) {
      // [A8 §5] caveat (i): the column "is [SD §4.7]'s declaration, quoted… nothing in this column
      // is assumed". A disagreement is the quotation having gone stale.
      expect(row.family, `[A8 §5] row ${row.row} (${row.type})`).toBe(
        CANONICAL_SUBJECT_FAMILY[row.type],
      )
      expect(isAssertionType(row.type)).toBe(true)
      expect(row.citations.length, `[A8 §5] row ${row.row} cites nothing`).toBeGreaterThan(0)
    }
    // [A8 §9 item 8]: sixteen rows, and still no completeness check — the classes it does not
    // reach are uncovered. Asserted so that a table which quietly grew a row without A8 saying so
    // is not mistaken for coverage.
    expect(tables.authority.rows.size).toBe(16)
    expect(tables.authority.byType.size).toBe(16)
    const uncovered = ASSERTION_TYPES.filter((type) => !tables.authority.byType.has(type))
    expect(uncovered.length).toBe(ASSERTION_TYPES.length - 16)
  })
})
